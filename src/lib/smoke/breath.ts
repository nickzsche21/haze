import type { FaceSignals, Pt } from "../face/signals";

export type Phase = "idle" | "drag" | "hold" | "exhale";

/**
 * `amount` is the charge spent this frame and sets how many particles appear;
 * `force` is 0..1 and sets how hard they are thrown. Keeping them apart is what
 * lets a wide-open mouth blow a fast thin jet and a narrow one seep a slow fat
 * cloud from the same lungful.
 */
export type Emission =
  | { type: "MOUTH_BURST"; origin: Pt; dir: Pt; amount: number; force: number; spread: number }
  | { type: "NOSE_BURST"; origins: [Pt, Pt]; dir: Pt; amount: number; force: number }
  | { type: "RING"; origin: Pt; dir: Pt; amount: number; radius: number };

export interface Attractor {
  p: Pt;
  radius: number;
  strength: number;
  kind: "mouth" | "nose";
}

export interface BreathState {
  phase: Phase;
  /** 0..1 — how much smoke is currently loaded in the lungs. */
  charge: number;
  /** 0..1 — cheeks-full, drives the held-smoke bulge on the prop. */
  held: number;
  /** True while smoke is leaving through the nose. */
  venting: boolean;
  emissions: Emission[];
  attractors: Attractor[];
  /** 0..1 — how hot the cigarette tip should look right now. */
  ember: number;
  /** Set for one frame when a release begins, so tricks and audio can latch on. */
  released: null | { type: Emission["type"]; strength: number; heldMs: number };
}

const T = {
  dragPucker: 0.42,
  dragMaxOpen: 0.2,
  openBurst: 0.3,
  ringFunnel: 0.46,
  ringOpenLo: 0.1,
  ringOpenHi: 0.52,
  autoNoseMs: 2400,
  minCharge: 0.07,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Turns a stream of facial signals into breaths.
 *
 * The model is deliberately physical rather than gestural: pursing your lips
 * loads charge, closing your mouth holds it, and opening it spends it. Every
 * trick in the app falls out of that loop plus the attractors below — nothing
 * here plays a canned animation.
 */
export class BreathEngine {
  private phase: Phase = "idle";
  private charge = 0;
  private holdStart = 0;
  private dragMs = 0;
  private lastReleaseAt = -Infinity;
  private ringCooldown = 0;
  private freebie = true;

  reset() {
    this.phase = "idle";
    this.charge = 0;
    this.dragMs = 0;
    this.ringCooldown = 0;
  }

  get currentPhase() {
    return this.phase;
  }

  step(s: FaceSignals, tMs: number, dtMs: number): BreathState {
    const dt = dtMs / 1000;
    const emissions: Emission[] = [];
    let released: BreathState["released"] = null;
    this.ringCooldown = Math.max(0, this.ringCooldown - dtMs);

    const dragging = s.pucker > T.dragPucker && s.open < T.dragMaxOpen;
    // Head aim steers the plume; the small upward bias keeps a level exhale from
    // hugging the chin the way a purely horizontal vector does.
    const dir = normalise({ x: s.dir.x * 0.9, y: s.dir.y * 0.7 - 0.35 });

    switch (this.phase) {
      case "idle": {
        if (dragging) {
          this.phase = "drag";
          this.dragMs = 0;
        } else if (s.open > 0.45 && this.freebie) {
          // Nobody reads instructions. A wide-open mouth on a cold start still
          // gets a puff, which is how most people discover the rest.
          this.charge = 0.42;
          this.phase = "exhale";
          this.freebie = false;
          this.holdStart = tMs;
          released = { type: "MOUTH_BURST", strength: 0.42, heldMs: 0 };
        }
        break;
      }

      case "drag": {
        this.dragMs += dtMs;
        this.charge = clamp01(this.charge + dt * 0.85 * (0.45 + 0.55 * s.pucker));
        if (!dragging) {
          this.phase = this.charge > T.minCharge ? "hold" : "idle";
          this.holdStart = tMs;
        }
        break;
      }

      case "hold": {
        this.charge = Math.max(0, this.charge - dt * 0.05); // lungs leak
        const heldMs = tMs - this.holdStart;
        const ringReady = s.funnel > T.ringFunnel && s.open > T.ringOpenLo && s.open < T.ringOpenHi;

        if (ringReady && this.ringCooldown <= 0 && this.charge > 0.12) {
          const strength = Math.min(this.charge, 0.5);
          this.charge -= strength;
          this.ringCooldown = 430;
          emissions.push({
            type: "RING",
            origin: s.mouth,
            dir,
            amount: strength,
            radius: Math.max(10, s.scale * 0.16 + s.aperture * 0.35),
          });
          released = { type: "RING", strength, heldMs };
          if (this.charge <= T.minCharge) this.phase = "idle";
        } else if (s.open > T.openBurst) {
          this.phase = "exhale";
          released = { type: "MOUTH_BURST", strength: this.charge, heldMs };
        } else if (heldMs > T.autoNoseMs || s.browUp > 0.55) {
          // Hold it long enough without opening up and it has to go somewhere.
          const strength = this.charge;
          this.phase = "exhale";
          released = { type: "NOSE_BURST", strength, heldMs };
          this.noseRelease = true;
        } else if (dragging) {
          this.phase = "drag";
        }
        break;
      }

      case "exhale": {
        const heldMs = tMs - this.holdStart;
        if (this.noseRelease) {
          const rate = Math.min(this.charge, dt * 0.42);
          this.charge -= rate;
          if (rate > 0.0005) {
            emissions.push({ type: "NOSE_BURST", origins: s.nostrils, dir, amount: rate, force: 1 });
          }
          if (this.charge <= 0.004 || s.open > T.openBurst) {
            this.noseRelease = false;
            if (s.open > T.openBurst && this.charge > 0.02) {
              released = { type: "MOUTH_BURST", strength: this.charge, heldMs };
            } else {
              this.phase = "idle";
              this.charge = 0;
            }
          }
        } else {
          // A wide mouth dumps the lot; a narrow one feathers it out. This is the
          // whole reason exhales feel controllable instead of scripted.
          const openness = clamp01((s.open - 0.12) / 0.6);
          const rate = Math.min(this.charge, dt * (0.2 + 0.72 * openness));
          this.charge -= rate;
          if (rate > 0.0005) {
            emissions.push({
              type: "MOUTH_BURST",
              origin: s.mouth,
              dir,
              amount: rate,
              force: openness,
              spread: 0.22 + 0.42 * openness,
            });
          }
          if (this.charge <= 0.004) {
            this.phase = "idle";
            this.charge = 0;
          } else if (s.pucker > 0.55 && s.open < 0.18) {
            // Sucked back in mid-exhale: that is a ghost inhale, and the leftover
            // charge stays in the lungs for the next release.
            this.phase = "hold";
            this.holdStart = tMs;
          }
        }
        break;
      }
    }

    if (released) this.lastReleaseAt = tMs;

    // Attractors run every frame regardless of phase. Pursed lips pull smoke
    // back toward the mouth; the nose always drinks a little of whatever drifts
    // past it, which is what makes a slow exhale turn into a French inhale
    // without anyone coding a "French inhale".
    const attractors: Attractor[] = [];
    const suck = clamp01((s.pucker - 0.35) / 0.5) * (1 - clamp01(s.open / 0.35));
    if (suck > 0.02) {
      attractors.push({ p: s.mouth, radius: s.scale * 2.1, strength: suck, kind: "mouth" });
    }
    // A nose that is currently venting a dragon has no business inhaling.
    const noseDraw = this.noseRelease ? 0 : this.phase === "exhale" ? 0.55 : 0.22;
    if (noseDraw > 0) attractors.push({
      p: { x: (s.nostrils[0].x + s.nostrils[1].x) / 2, y: (s.nostrils[0].y + s.nostrils[1].y) / 2 },
      radius: s.scale * 0.55,
      strength: noseDraw,
      kind: "nose",
    });

    const ember = clamp01(
      this.phase === "drag" ? 0.35 + 0.65 * s.pucker : Math.max(0, 0.28 - (tMs - this.lastReleaseAt) / 4000),
    );

    return {
      phase: this.phase,
      charge: this.charge,
      held: clamp01(Math.max(s.cheeks, this.phase === "hold" ? this.charge * 0.6 : 0)),
      venting: this.noseRelease,
      emissions,
      attractors,
      ember,
      released,
    };
  }

  private noseRelease = false;
}

function normalise(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}
