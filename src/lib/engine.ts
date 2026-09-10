import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { Sfx } from "./audio/sfx";
import { demoSignals } from "./demo";
import { loadVision, readFace, readHand, type Vision } from "./face/landmarker";
import { SignalSmoother, type FaceSignals } from "./face/signals";
import { SmokeRenderer } from "./gl/renderer";
import { drawProp, placeProp, type PropPlacement } from "./props";
import { BreathEngine, type Phase } from "./smoke/breath";
import { Emitter } from "./smoke/emitter";
import { DEFAULT_MODE, type Mode } from "./smoke/modes";
import { EMBER_STRIDE, ParticleSystem, SMOKE_STRIDE } from "./smoke/particles";
import { TrickTracker, type TrickEvent } from "./smoke/tricks";

export type EngineStatus = "idle" | "starting" | "running" | "error";

export interface HudStats {
  fps: number;
  phase: Phase;
  charge: number;
  cloud: number;
  bestCloud: number;
  score: number;
  combo: number;
  particles: number;
  faceFound: boolean;
  handFound: boolean;
  quality: number;
}

export interface EngineCallbacks {
  onStatus(status: EngineStatus, detail?: string): void;
  onStats(stats: HudStats): void;
  onTrick(trick: TrickEvent): void;
}

interface Popup {
  text: string;
  note: string;
  points: number;
  combo: number;
  x: number;
  y: number;
  born: number;
  /** Stacking row, so two tricks in quick succession do not print on top of each other. */
  slot: number;
}

const MAX_W = 1280;
const BEST_KEY = "haze.bestCloud";

export class Engine {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private glCanvas: HTMLCanvasElement;
  private renderer: SmokeRenderer | null = null;
  private cb: EngineCallbacks;

  private vision: Vision | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;

  private smoother = new SignalSmoother();
  private breath = new BreathEngine();
  private emitter = new Emitter();
  private particles = new ParticleSystem(8000);
  private tricks: TrickTracker;
  readonly sfx = new Sfx();

  private smokeBuf = new Float32Array(8000 * SMOKE_STRIDE);
  private emberBuf = new Float32Array(900 * EMBER_STRIDE);

  private mode: Mode = DEFAULT_MODE;
  private showProp = true;
  private mirror = true;

  private lastFrameTime = 0;
  private lastVideoTime = -1;
  private frame = 0;
  private fpsAvg = 60;
  private slowFrames = 0;
  private fastFrames = 0;

  private signals: FaceSignals | null = null;
  private hand: NormalizedLandmark[] | null = null;
  private handMissing = 0;
  private popups: Popup[] = [];
  private vignette: HTMLCanvasElement | null = null;
  private demo = false;
  private demoBackdrop: HTMLCanvasElement | null = null;
  private lastStatsPush = 0;
  private noFaceSince = 0;
  private idleSince = 0;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.video = video;
    this.canvas = canvas;
    this.cb = cb;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.glCanvas = document.createElement("canvas");
    const best = typeof localStorage !== "undefined" ? Number(localStorage.getItem(BEST_KEY) ?? 0) : 0;
    this.tricks = new TrickTracker(Number.isFinite(best) ? best : 0);
  }

  setMode(mode: Mode) {
    this.mode = mode;
  }

  setShowProp(on: boolean) {
    this.showProp = on;
  }

  setMirror(on: boolean) {
    this.mirror = on;
  }

  clearSmoke() {
    this.particles.clear();
    this.breath.reset();
  }

  resetScore() {
    this.tricks.reset();
  }

  async start(opts: { hands: boolean; demo?: boolean }) {
    if (opts.demo) return this.startDemo();
    this.cb.onStatus("starting", "Waking the camera");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: MAX_W }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      this.cb.onStatus("error", cameraError(err));
      return;
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => undefined);
    await waitForVideo(this.video);

    this.cb.onStatus("starting", "Loading the face model");
    try {
      this.vision = await loadVision({ hands: opts.hands });
    } catch (err) {
      this.cb.onStatus("error", `Could not load the vision model. ${err instanceof Error ? err.message : ""}`.trim());
      return;
    }

    try {
      this.renderer = new SmokeRenderer(this.glCanvas);
    } catch (err) {
      this.cb.onStatus("error", `WebGL2 is required for the smoke. ${err instanceof Error ? err.message : ""}`.trim());
      return;
    }

    this.sizeToVideo();
    this.running = true;
    this.lastFrameTime = performance.now();
    this.cb.onStatus("running");
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Runs the full pipeline against synthetic breath — no camera, no models. */
  private startDemo() {
    this.demo = true;
    this.canvas.width = 1280;
    this.canvas.height = 720;
    try {
      this.renderer = new SmokeRenderer(this.glCanvas);
    } catch (err) {
      this.cb.onStatus("error", `WebGL2 is required for the smoke. ${err instanceof Error ? err.message : ""}`.trim());
      return;
    }
    this.renderer.resize(1280, 720);
    this.vignette = buildVignette(1280, 720);
    this.demoBackdrop = buildBackdrop(1280, 720);
    this.running = true;
    this.lastFrameTime = performance.now();
    this.cb.onStatus("running");
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.vision?.close();
    this.vision = null;
    this.sfx.dispose();
  }

  private sizeToVideo() {
    const vw = this.video.videoWidth || 1280;
    const vh = this.video.videoHeight || 720;
    const w = Math.min(MAX_W, vw);
    const h = Math.round((w / vw) * vh);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.renderer?.resize(w, h);
      this.vignette = buildVignette(w, h);
    }
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frameAt(performance.now());
  };

  /**
   * One simulation-and-draw step at an explicit timestamp.
   *
   * Kept separate from the rAF callback so a fixed-step harness can drive the
   * whole pipeline without a live clock — browsers suspend rAF in a hidden tab,
   * which otherwise makes the renderer impossible to exercise headlessly.
   */
  frameAt(now: number) {
    // Clamp dt: a backgrounded tab returns with a huge delta that would fling
    // every particle off-screen in one step.
    const dtMs = Math.min(50, now - this.lastFrameTime);
    this.lastFrameTime = now;
    this.frame++;
    this.fpsAvg += (1000 / Math.max(1, dtMs) - this.fpsAvg) * 0.06;
    this.adaptQuality();
    if (!this.demo) this.sizeToVideo();

    const W = this.canvas.width;
    const H = this.canvas.height;

    if (this.demo) {
      this.signals = demoSignals(now / 1000, W, H);
      this.hand = null;
    } else {
      const vision = this.vision;
      if (!vision) return;
      this.track(vision, now, dtMs, W, H);
    }

    const s = this.signals;
    const dt = dtMs / 1000;
    let place: PropPlacement | null = null;

    if (s) {
      const state = this.breath.step(s, now, dtMs);
      place = this.showProp && this.mode.prop !== "none" ? placeProp(this.hand, s, W, H) : null;

      for (const e of state.emissions) {
        this.emitter.emit(this.particles, e, this.mode, s.scale);
      }
      if (state.released) {
        const kind = state.released.type === "NOSE_BURST" ? "nose" : state.released.type === "RING" ? "ring" : "mouth";
        this.sfx.exhale(state.released.strength, kind);
        const from = kind === "nose" ? s.nostrils[0] : s.mouth;
        this.emitter.sparks(this.particles, from, s.dir, this.mode, state.released.strength);
        this.idleSince = now;
      }
      if (state.phase === "drag") {
        this.sfx.crackle(state.ember);
        this.idleSince = now;
      }
      if (place && state.phase !== "exhale") {
        this.emitter.wisp(this.particles, place.tip, this.mode, s.scale, dtMs);
      }

      this.particles.update(dt, now / 1000, this.mode.smoke, state.attractors, { w: W, h: H });

      const score = this.tricks.step(
        state,
        { volume: this.particles.volume, absorbedMouth: this.particles.absorbedMouth, absorbedNose: this.particles.absorbedNose },
        now,
      );
      for (const ev of score.events) {
        if (this.popups.length >= 3) this.popups.shift();
        const taken = new Set(this.popups.map((p) => p.slot));
        let slot = 0;
        while (taken.has(slot)) slot++;
        this.popups.push({
          text: ev.name,
          note: ev.note,
          points: ev.points,
          combo: ev.combo,
          x: s.mouth.x,
          y: s.mouth.y - s.scale * 1.4,
          born: now,
          slot,
        });
        this.sfx.trick(ev.combo);
        this.cb.onTrick(ev);
      }
      this.persistBest(score.bestCloud);
      this.pushStats(now, state.phase, state.charge, score);
      this.emberState = { at: place?.tip ?? s.mouth, intensity: state.ember };
    } else {
      this.particles.update(dt, now / 1000, this.mode.smoke, [], { w: W, h: H });
      this.pushStats(now, "idle", 0, null);
      this.emberState = null;
    }

    this.draw(now, place, s);
  }

  private emberState: { at: { x: number; y: number }; intensity: number } | null = null;

  /**
   * MediaPipe rejects a repeated timestamp, and there is nothing to gain from
   * running detection twice on the same camera frame.
   */
  private track(vision: Vision, now: number, dtMs: number, W: number, H: number) {
    if (this.video.currentTime === this.lastVideoTime || this.video.readyState < 2) return;
    this.lastVideoTime = this.video.currentTime;

    const face = readFace(vision.face, this.video, now);
    if (face) {
      this.signals = this.smoother.update(face, W, H, dtMs);
      this.noFaceSince = 0;
    } else {
      if (this.noFaceSince === 0) this.noFaceSince = now;
      if (now - this.noFaceSince > 700) {
        this.signals = null;
        this.smoother.reset();
        this.breath.reset();
      }
    }

    // Hands cost roughly as much as the face model; a third of the rate is
    // invisible on a prop that barely moves between frames.
    if (vision.hands && this.frame % 3 === 0) {
      const h = readHand(vision.hands, this.video, now + 0.5);
      if (h) {
        this.hand = h.landmarks;
        this.handMissing = 0;
      } else if (++this.handMissing > 6) {
        this.hand = null;
      }
    }
  }

  private persistBest(best: number) {
    if (typeof localStorage === "undefined") return;
    if (best > 0 && this.frame % 120 === 0) localStorage.setItem(BEST_KEY, String(best));
  }

  private adaptQuality() {
    if (this.fpsAvg < 44) {
      this.slowFrames++;
      this.fastFrames = 0;
      if (this.slowFrames > 45) {
        this.emitter.quality = Math.max(0.35, this.emitter.quality - 0.15);
        this.slowFrames = 0;
      }
    } else if (this.fpsAvg > 57) {
      this.fastFrames++;
      this.slowFrames = 0;
      if (this.fastFrames > 180) {
        this.emitter.quality = Math.min(1, this.emitter.quality + 0.1);
        this.fastFrames = 0;
      }
    }
  }

  private pushStats(now: number, phase: Phase, charge: number, score: ReturnType<TrickTracker["step"]> | null) {
    if (now - this.lastStatsPush < 100) return;
    this.lastStatsPush = now;
    this.cb.onStats({
      fps: Math.round(this.fpsAvg),
      phase,
      charge,
      cloud: score?.cloud ?? 0,
      bestCloud: score?.bestCloud ?? 0,
      score: score?.score ?? 0,
      combo: score?.combo ?? 0,
      particles: this.particles.count,
      faceFound: !!this.signals,
      handFound: !!this.hand,
      quality: this.emitter.quality,
    });
  }

  private draw(now: number, place: PropPlacement | null, s: FaceSignals | null) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#08090c";
    ctx.fillRect(0, 0, W, H);

    if (this.demo) {
      if (this.demoBackdrop) ctx.drawImage(this.demoBackdrop, 0, 0);
    } else if (this.video.readyState >= 2) {
      ctx.save();
      if (this.mirror) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, 0, 0, W, H);
      ctx.restore();
    }

    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    // Prop under the smoke: the plume should pass in front of the cigarette,
    // not the other way round.
    if (place && s) drawProp(ctx, this.mode.prop, place, this.mode, this.emberState?.intensity ?? 0);

    if (this.renderer) {
      const smokeCount = this.particles.writeSmoke(this.smokeBuf, this.mode.smoke);
      const emberCount = this.particles.embers.write(this.emberBuf);
      this.renderer.render(this.smokeBuf, smokeCount, this.emberBuf, emberCount, {
        palette: this.mode.palette,
        opacity: 1,
        ember: this.emberState
          ? { x: this.emberState.at.x, y: this.emberState.at.y, intensity: this.emberState.intensity }
          : null,
      });
      if (smokeCount > 0 || emberCount > 0) ctx.drawImage(this.glCanvas, 0, 0, W, H);
    }

    this.drawOverlay(now, s);
  }

  /**
   * Everything painted here also lands in a recorded clip, which is why the
   * score and the wordmark live on the canvas rather than in the DOM HUD.
   */
  private drawOverlay(now: number, s: FaceSignals | null) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const u = W / 1280;

    this.popups = this.popups.filter((p) => now - p.born < 1700);
    for (const p of this.popups) {
      const t = (now - p.born) / 1700;
      const rise = Math.pow(t, 0.55) * 90 * u;
      const alpha = t < 0.12 ? t / 0.12 : Math.pow(1 - t, 0.6);
      const pop = t < 0.18 ? 1.25 - 0.25 * (t / 0.18) : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y - rise - p.slot * 52 * u);
      ctx.scale(pop, pop);
      ctx.textAlign = "center";
      ctx.font = `800 ${34 * u}px ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 7 * u;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = this.mode.accent;
      ctx.fillText(p.text, 0, 0);

      ctx.font = `600 ${19 * u}px ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 5 * u;
      ctx.strokeText(`+${p.points}${p.combo > 1 ? `  x${p.combo}` : ""}`, 0, 27 * u);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`+${p.points}${p.combo > 1 ? `  x${p.combo}` : ""}`, 0, 27 * u);
      ctx.restore();
    }

    if (!s && !this.demo) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 420);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.textAlign = "center";
      ctx.font = `700 ${26 * u}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText("step into frame", W / 2, H / 2);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.textAlign = "right";
    ctx.font = `800 ${17 * u}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("HAZE", W - 20 * u, H - 18 * u);
    ctx.restore();
  }
}

/** The empty, low-lit room the demo smoke drifts through. */
function buildBackdrop(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, w, h);
  const key = ctx.createRadialGradient(w * 0.5, h * 0.52, 0, w * 0.5, h * 0.52, h * 0.85);
  key.addColorStop(0, "rgba(120,130,160,0.16)");
  key.addColorStop(0.5, "rgba(60,66,86,0.07)");
  key.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function buildVignette(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function waitForVideo(video: HTMLVideoElement) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
  });
}

function cameraError(err: unknown) {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return "Camera permission was denied. Allow it in your browser's site settings and reload.";
  if (name === "NotFoundError") return "No camera found on this device.";
  if (name === "NotReadableError") return "Another app is holding the camera. Close it and try again.";
  return "Could not open the camera.";
}
