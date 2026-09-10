import type { BreathState } from "./breath";

export interface TrickEvent {
  id: string;
  name: string;
  note: string;
  points: number;
  combo: number;
  at: number;
}

export interface ScoreState {
  score: number;
  combo: number;
  /** 0..1 — how big the current cloud is against a very large one. */
  cloud: number;
  bestCloud: number;
  events: TrickEvent[];
}

const COMBO_WINDOW_MS = 4200;
const BURST_WINDOW_MS = 2300;
/** Volume, in px² of shaded smoke, that counts as a full meter. Tuned by eye. */
const CLOUD_FULL = 620_000;

interface Window {
  t0: number;
  strength: number;
  mouth0: number;
  nose0: number;
  peak: number;
  resolved: boolean;
}

/**
 * Watches breath releases and the particle system's absorption counters, and
 * names what it sees.
 *
 * Nothing here drives the simulation — a ghost inhale is only recognised because
 * the smoke really did get sucked back into the mouth.
 */
export class TrickTracker {
  private score = 0;
  private combo = 0;
  private lastScoreAt = -Infinity;
  private window: Window | null = null;
  private pending: TrickEvent[] = [];
  private cloud = 0;
  private bestCloud = 0;
  private seq = 0;
  /** Last time each trick fired, so a held funnel cannot farm the same award. */
  private lastOf = new Map<string, number>();

  constructor(bestCloud = 0) {
    this.bestCloud = bestCloud;
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.window = null;
    this.pending = [];
    this.lastOf.clear();
    this.cloud = 0;
  }

  private award(id: string, name: string, note: string, base: number, tMs: number) {
    if (tMs - (this.lastOf.get(id) ?? -Infinity) < 1100) return;
    this.lastOf.set(id, tMs);
    const combo = tMs - this.lastScoreAt < COMBO_WINDOW_MS ? Math.min(this.combo + 1, 5) : 1;
    this.combo = combo;
    this.lastScoreAt = tMs;
    const points = Math.round(base * combo);
    this.score += points;
    this.pending.push({ id: `${id}-${this.seq++}`, name, note, points, combo, at: tMs });
  }

  step(
    breath: BreathState,
    stats: { volume: number; absorbedMouth: number; absorbedNose: number },
    tMs: number,
  ): ScoreState {
    this.cloud = Math.min(1, stats.volume / CLOUD_FULL);
    if (this.cloud > this.bestCloud) this.bestCloud = this.cloud;

    const rel = breath.released;
    if (rel) {
      if (rel.type === "RING") {
        this.award("ring", "SMOKE RING", "clean O", 160 + Math.round(rel.strength * 180), tMs);
      } else if (rel.type === "NOSE_BURST") {
        const heavy = rel.strength > 0.55;
        this.award(
          "dragon",
          heavy ? "FULL DRAGON" : "DRAGON",
          heavy ? "both barrels" : "through the nose",
          heavy ? 320 : 190,
          tMs,
        );
      } else if (rel.type === "MOUTH_BURST") {
        this.window = {
          t0: tMs,
          strength: rel.strength,
          mouth0: stats.absorbedMouth,
          nose0: stats.absorbedNose,
          peak: 0,
          resolved: false,
        };
        if (rel.heldMs > 2600) this.award("patience", "LUNG CAPACITY", `held ${(rel.heldMs / 1000).toFixed(1)}s`, 140, tMs);
      }
    }

    const w = this.window;
    if (w && !w.resolved) {
      w.peak = Math.max(w.peak, stats.volume);
      const noseAbs = stats.absorbedNose - w.nose0;
      const mouthAbs = stats.absorbedMouth - w.mouth0;

      if (noseAbs >= 22) {
        this.award("french", "FRENCH INHALE", "up and in", 340, tMs);
        w.resolved = true;
      } else if (mouthAbs >= 45) {
        this.award("ghost", "GHOST INHALE", "took it back", 300, tMs);
        w.resolved = true;
      } else if (tMs - w.t0 > BURST_WINDOW_MS) {
        const meter = Math.min(1, w.peak / CLOUD_FULL);
        if (meter > 0.55) {
          this.award("cloud", meter > 0.85 ? "MONSTER CLOUD" : "BIG CLOUD", `${Math.round(meter * 100)}% cloud`, Math.round(meter * 260), tMs);
        }
        w.resolved = true;
      }
    }

    if (tMs - this.lastScoreAt > COMBO_WINDOW_MS) this.combo = 0;

    const events = this.pending;
    this.pending = [];
    return {
      score: this.score,
      combo: this.combo,
      cloud: this.cloud,
      bestCloud: this.bestCloud,
      events,
    };
  }
}
