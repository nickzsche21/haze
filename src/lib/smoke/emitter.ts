import type { Emission } from "./breath";
import type { Mode } from "./modes";
import type { ParticleSystem } from "./particles";
import type { Pt } from "../face/signals";

const TAU = Math.PI * 2;

/** Box–Muller, clamped. Gaussian jitter looks like breath; uniform looks like a spray can. */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v) * 0.4;
  return g < -1 ? -1 : g > 1 ? 1 : g;
}

/**
 * Turns breath events into particles.
 *
 * Emission counts arrive as fractions of a particle per frame, so the residual
 * is carried between frames — otherwise slow exhales round to zero and vanish.
 */
export class Emitter {
  private residual = 0;
  quality = 1;

  emit(ps: ParticleSystem, e: Emission, mode: Mode, faceScale: number) {
    switch (e.type) {
      case "MOUTH_BURST":
        this.mouthBurst(ps, e, mode, faceScale);
        break;
      case "NOSE_BURST":
        this.noseBurst(ps, e, mode, faceScale);
        break;
      case "RING":
        this.ring(ps, e, mode, faceScale);
        break;
    }
  }

  private take(n: number) {
    this.residual += n * this.quality;
    const whole = Math.floor(this.residual);
    this.residual -= whole;
    return whole;
  }

  private mouthBurst(
    ps: ParticleSystem,
    e: Extract<Emission, { type: "MOUTH_BURST" }>,
    mode: Mode,
    faceScale: number,
  ) {
    const p = mode.smoke;
    const count = this.take(p.rate * e.amount);
    if (count <= 0) return;
    const sizeK = faceScale / 120;
    // Start just clear of the lips so the plume never paints over the mouth.
    const ox = e.origin.x + e.dir.x * faceScale * 0.1;
    const oy = e.origin.y + e.dir.y * faceScale * 0.1;

    for (let i = 0; i < count; i++) {
      const ang = Math.atan2(e.dir.y, e.dir.x) + gauss() * e.spread;
      const speed = p.jetSpeed * (0.4 + 0.8 * e.force) * (0.6 + Math.random() * 0.7);
      const j = faceScale * 0.06;
      ps.spawn({
        x: ox + gauss() * j,
        y: oy + gauss() * j * 0.7,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        size: p.size * sizeK * (0.65 + Math.random() * 0.8),
        life: p.lifeSec * (0.7 + Math.random() * 0.7),
        heat: 0.75 + Math.random() * 0.35,
        density: p.density * (0.7 + Math.random() * 0.6),
      });
    }
  }

  private noseBurst(
    ps: ParticleSystem,
    e: Extract<Emission, { type: "NOSE_BURST" }>,
    mode: Mode,
    faceScale: number,
  ) {
    const p = mode.smoke;
    const count = this.take(p.rate * e.amount);
    if (count <= 0) return;
    const sizeK = faceScale / 120;
    // Nose smoke falls before it climbs — that downward hook is the whole look.
    const baseAng = Math.atan2(0.72, e.dir.x * 0.55);

    for (let i = 0; i < count; i++) {
      const nostril = e.origins[i & 1];
      const outward = (i & 1) === 0 ? -1 : 1;
      const ang = baseAng + gauss() * 0.14 + outward * 0.17;
      const speed = p.jetSpeed * 0.78 * e.force * (0.6 + Math.random() * 0.6);
      const j = faceScale * 0.022;
      ps.spawn({
        x: nostril.x + gauss() * j,
        y: nostril.y + gauss() * j,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        size: p.size * sizeK * (0.42 + Math.random() * 0.5),
        life: p.lifeSec * (0.85 + Math.random() * 0.6),
        heat: 0.9 + Math.random() * 0.4,
        density: p.density * (0.8 + Math.random() * 0.5),
        turb: 0.75,
      });
    }
  }

  private ring(ps: ParticleSystem, e: Extract<Emission, { type: "RING" }>, mode: Mode, faceScale: number) {
    const p = mode.smoke;
    const count = Math.round((260 + 340 * e.amount) * this.quality);
    const sizeK = faceScale / 120;
    const speed = p.jetSpeed * (0.22 + 0.3 * e.amount);
    const ox = e.origin.x + e.dir.x * faceScale * 0.13;
    const oy = e.origin.y + e.dir.y * faceScale * 0.13;
    // A vortex ring leaving your mouth is seen almost face-on, so the circle is
    // squashed vertically and expands as it goes.
    const squash = 0.46;

    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.random() * 0.05;
      const rx = Math.cos(a);
      const ry = Math.sin(a) * squash;
      // Scatter each particle through the ring's tube cross-section so the
      // thing reads as a torus rather than a bead necklace.
      const tube = e.radius * 0.3;
      const tubeA = Math.random() * TAU;
      const tubeR = Math.sqrt(Math.random()) * tube;
      const jitter = 1 + gauss() * 0.06;
      ps.spawn({
        x: ox + rx * e.radius * jitter + Math.cos(tubeA) * tubeR,
        y: oy + ry * e.radius * jitter + Math.sin(tubeA) * tubeR * 0.8,
        vx: e.dir.x * speed * (0.9 + Math.random() * 0.2),
        vy: e.dir.y * speed * (0.9 + Math.random() * 0.2),
        rx,
        ry,
        radial: 55 + 70 * e.amount,
        size: p.size * sizeK * (0.5 + Math.random() * 0.35),
        life: p.lifeSec * (1.25 + Math.random() * 0.5),
        heat: 0.5 + Math.random() * 0.2,
        density: p.density * 1.25,
        turb: 0.22, // rings only survive if the curl field mostly leaves them alone
        noAbsorb: true, // and only if your own nose cannot hoover them up
      });
    }
  }

  /** The lazy curl of smoke off an unattended tip. */
  wisp(ps: ParticleSystem, at: Pt, mode: Mode, faceScale: number, dtMs: number) {
    if (mode.idleWisp <= 0) return;
    const n = this.take(mode.idleWisp * (dtMs / 1000) * 22);
    const sizeK = faceScale / 120;
    for (let i = 0; i < n; i++) {
      ps.spawn({
        x: at.x + gauss() * 2.5,
        y: at.y + gauss() * 2.5,
        vx: gauss() * 12,
        vy: -26 - Math.random() * 22,
        size: mode.smoke.size * sizeK * 0.3 * (0.6 + Math.random() * 0.6),
        life: mode.smoke.lifeSec * (0.8 + Math.random() * 0.6),
        heat: 1.1,
        density: mode.smoke.density * 0.42,
        turb: 1.25,
      });
    }
  }

  sparks(ps: ParticleSystem, at: Pt, dir: Pt, mode: Mode, strength: number) {
    const n = Math.round(mode.sparks * strength * 2);
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(dir.y, dir.x) + gauss() * 0.55;
      const sp = 120 + Math.random() * 320 * strength;
      ps.embers.spawn(at.x, at.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 1.6 + Math.random() * 2.6, 0.5 + Math.random() * 0.8);
    }
  }
}
