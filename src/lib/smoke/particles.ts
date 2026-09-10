import type { Attractor } from "./breath";
import type { SmokePreset } from "./modes";

export const SMOKE_STRIDE = 8; // x, y, size, rot, alpha, heat, seed, variant
export const EMBER_STRIDE = 6; // x, y, size, alpha, heat, seed

export interface SpawnSmoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  heat: number;
  density: number;
  /** Outward speed (px/s) along the spawn radius — this is what makes a ring a ring. */
  radial?: number;
  /** Scales how hard the curl field shakes this particle. Rings want ~0.25. */
  turb?: number;
  /**
   * Opt out of airflow entirely — no pull, no absorption. A vortex ring carries
   * its own momentum and should sail past your nose untouched.
   */
  noAbsorb?: boolean;
  rx?: number;
  ry?: number;
}

/**
 * A fixed-capacity particle pool. Everything lives in flat typed arrays and dead
 * particles are swap-removed, so a full frame allocates nothing.
 */
export class ParticleSystem {
  readonly capacity: number;
  count = 0;

  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size0: Float32Array;
  private heat: Float32Array;
  private density: Float32Array;
  private rot: Float32Array;
  private rotV: Float32Array;
  private seed: Float32Array;
  private turb: Float32Array;
  private noAbsorb: Uint8Array;

  embers: EmberSystem;

  /** Particles eaten by an attractor since the last read — the ghost-inhale meter. */
  absorbedMouth = 0;
  absorbedNose = 0;
  /** Sum of alpha*area over living smoke, in screen px² — the cloud-size meter. */
  volume = 0;

  constructor(capacity = 7000) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.heat = f();
    this.density = f();
    this.rot = f();
    this.rotV = f();
    this.seed = f();
    this.turb = f();
    this.noAbsorb = new Uint8Array(capacity);
    this.embers = new EmberSystem(900);
  }

  clear() {
    this.count = 0;
    this.embers.count = 0;
  }

  spawn(p: SpawnSmoke) {
    if (this.count >= this.capacity) {
      // At capacity the oldest smoke is the least interesting; make room for the
      // new breath rather than dropping it.
      this.remove(this.oldestIndex());
    }
    const i = this.count++;
    this.x[i] = p.x;
    this.y[i] = p.y;
    // Outward expansion is just part of the launch velocity; drag tapers it.
    const r = p.radial ?? 0;
    this.vx[i] = p.vx + (p.rx ?? 0) * r;
    this.vy[i] = p.vy + (p.ry ?? 0) * r;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.size0[i] = p.size;
    this.heat[i] = p.heat;
    this.density[i] = p.density;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotV[i] = (Math.random() - 0.5) * 0.9;
    this.seed[i] = Math.random();
    this.turb[i] = p.turb ?? 1;
    this.noAbsorb[i] = p.noAbsorb ? 1 : 0;
  }

  private oldestIndex() {
    let best = 0;
    let bestFrac = -1;
    // Sampling beats a full scan and picks something stale every time.
    for (let k = 0; k < 24; k++) {
      const i = (Math.random() * this.count) | 0;
      const frac = this.age[i] / this.life[i];
      if (frac > bestFrac) {
        bestFrac = frac;
        best = i;
      }
    }
    return best;
  }

  private remove(i: number) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.age[i] = this.age[last];
      this.life[i] = this.life[last];
      this.size0[i] = this.size0[last];
      this.heat[i] = this.heat[last];
      this.density[i] = this.density[last];
      this.rot[i] = this.rot[last];
      this.rotV[i] = this.rotV[last];
      this.seed[i] = this.seed[last];
      this.turb[i] = this.turb[last];
      this.noAbsorb[i] = this.noAbsorb[last];
    }
  }

  update(
    dt: number,
    tSec: number,
    preset: SmokePreset,
    attractors: Attractor[],
    bounds: { w: number; h: number },
  ) {
    const drag = Math.exp(-preset.drag * dt);
    const turb = preset.turbulence;
    const buoy = preset.buoyancy;
    let volume = 0;

    for (let i = 0; i < this.count; i++) {
      const a = (this.age[i] += dt);
      const lifeT = this.life[i];
      if (a >= lifeT) {
        this.remove(i--);
        continue;
      }
      const t = a / lifeT;

      let px = this.x[i];
      let py = this.y[i];
      let vxi = this.vx[i];
      let vyi = this.vy[i];

      // Curl of a scalar potential, so the field is divergence-free and the
      // smoke folds instead of spraying. Two octaves: broad drift plus wisps.
      const s = this.seed[i] * 6.283;
      const f1 = 0.0072;
      const ax = px * f1 + tSec * 0.45 + s;
      const ay = py * f1 - tSec * 0.32;
      const c1x = -Math.sin(ax) * Math.sin(ay);
      const c1y = -Math.cos(ax) * Math.cos(ay);

      const f2 = 0.021;
      const bx = px * f2 - tSec * 0.9 + s * 1.7;
      const by = py * f2 + tSec * 0.7;
      const c2x = -Math.sin(bx) * Math.sin(by);
      const c2y = -Math.cos(bx) * Math.cos(by);

      // Turbulence ramps in as the jet slows — a fresh plume is smooth, an old
      // one is all curl.
      const swirl = turb * this.turb[i] * (0.25 + 1.35 * t);
      vxi += (c1x * 1.0 + c2x * 0.45) * swirl * dt * 60;
      vyi += (c1y * 1.0 + c2y * 0.45) * swirl * dt * 60;

      // Hot smoke climbs; as it cools it just hangs.
      const heat = (this.heat[i] *= Math.exp(-dt / preset.coolSec));
      vyi -= (buoy * (0.25 + heat)) * dt * 60;

      vxi *= drag;
      vyi *= drag;

      let absorbed = false;
      const immune = this.noAbsorb[i] === 1;
      for (let k = 0; immune ? false : k < attractors.length; k++) {
        const at = attractors[k];
        if (at.strength <= 0.01) continue;
        const dx = at.p.x - px;
        const dy = at.p.y - py;
        const d2 = dx * dx + dy * dy;
        const r = at.radius;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 0.001;

        if (at.kind === "nose") {
          // The nose only drinks slow smoke drifting up past it, which is why a
          // gentle mouth exhale turns into a French inhale and a fast one doesn't.
          const rising = -vyi;
          if (rising < 4 || Math.hypot(vxi, vyi) > 190) continue;
        }
        const pull = at.strength * (1 - d / r) * (at.kind === "nose" ? 260 : 520);
        vxi += (dx / d) * pull * dt;
        vyi += (dy / d) * pull * dt;

        const eat = at.kind === "nose" ? r * 0.34 : r * 0.13;
        if (d < eat) {
          if (at.kind === "nose") this.absorbedNose++;
          else this.absorbedMouth++;
          absorbed = true;
          break;
        }
      }
      if (absorbed) {
        this.remove(i--);
        continue;
      }

      px += vxi * dt;
      py += vyi * dt;

      // Cheap off-screen cull with a generous margin so nothing pops at the edge.
      if (px < -260 || px > bounds.w + 260 || py < -400 || py > bounds.h + 260) {
        this.remove(i--);
        continue;
      }

      this.x[i] = px;
      this.y[i] = py;
      this.vx[i] = vxi;
      this.vy[i] = vyi;
      this.rot[i] += this.rotV[i] * dt;

      const size = this.size0[i] * (1 + preset.grow * t);
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      const fadeOut = Math.pow(1 - t, preset.fade);
      volume += size * size * fadeIn * fadeOut * this.density[i];
    }

    this.volume = volume;
    this.embers.update(dt, bounds);
  }

  /** Packs live smoke into an instance buffer. Returns the instance count. */
  writeSmoke(out: Float32Array, preset: SmokePreset): number {
    const n = Math.min(this.count, (out.length / SMOKE_STRIDE) | 0);
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const o = i * SMOKE_STRIDE;
      out[o] = this.x[i];
      out[o + 1] = this.y[i];
      out[o + 2] = this.size0[i] * (1 + preset.grow * t);
      out[o + 3] = this.rot[i];
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      out[o + 4] = this.density[i] * fadeIn * Math.pow(1 - t, preset.fade);
      out[o + 5] = this.heat[i];
      out[o + 6] = this.seed[i];
      out[o + 7] = (this.seed[i] * 4) | 0;
    }
    return n;
  }
}

/** Sparks: additive, gravity-bound, and far cheaper than smoke. */
export class EmberSystem {
  readonly capacity: number;
  count = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private seed: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.seed = f();
  }

  spawn(x: number, y: number, vx: number, vy: number, size: number, life: number) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.seed[i] = Math.random();
  }

  update(dt: number, bounds: { w: number; h: number }) {
    for (let i = 0; i < this.count; i++) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        this.swap(i--);
        continue;
      }
      this.vy[i] += (58 - 150 * (1 - a / this.life[i])) * dt; // buoyant, then falling
      this.vx[i] *= Math.exp(-1.4 * dt);
      this.vy[i] *= Math.exp(-1.4 * dt);
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] > bounds.h + 40 || this.x[i] < -40 || this.x[i] > bounds.w + 40) this.swap(i--);
    }
  }

  private swap(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size[i] = this.size[last];
    this.seed[i] = this.seed[last];
  }

  write(out: Float32Array): number {
    const n = Math.min(this.count, (out.length / EMBER_STRIDE) | 0);
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const o = i * EMBER_STRIDE;
      out[o] = this.x[i];
      out[o + 1] = this.y[i];
      out[o + 2] = this.size[i] * (1 - 0.45 * t);
      out[o + 3] = Math.pow(1 - t, 1.6);
      out[o + 4] = 1 - t * 0.7;
      out[o + 5] = this.seed[i];
    }
    return n;
  }
}
