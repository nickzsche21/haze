import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FaceFrame } from "./landmarker";

export interface Pt {
  x: number;
  y: number;
}

/** Canonical face-mesh indices we actually care about. */
const IDX = {
  lipInnerTop: 13,
  lipInnerBottom: 14,
  lipCornerL: 61,
  lipCornerR: 291,
  lipOuterTop: 0,
  lipOuterBottom: 17,
  noseTip: 1,
  noseBase: 2,
  nostrilL: 98,
  nostrilR: 327,
  eyeOuterL: 33,
  eyeOuterR: 263,
  browBridge: 168,
  foreheadTop: 10,
  chin: 152,
} as const;

export interface FaceSignals {
  /** Screen-space centre of the inner lips, in composite-canvas pixels. */
  mouth: Pt;
  nostrils: [Pt, Pt];
  chin: Pt;
  noseTip: Pt;
  /** Inter-ocular distance in px — the yardstick for every other length. */
  scale: number;
  /** 0..1 how far the jaw is dropped. */
  open: number;
  /** 0..1 lips pursed inward (a drag). */
  pucker: number;
  /** 0..1 lips pushed forward into an O (a ring). */
  funnel: number;
  /** 0..1 cheeks inflated (smoke held in the mouth). */
  cheeks: number;
  smile: number;
  browUp: number;
  /** Roughly -1..1 each: which way the head is aimed, in mirrored screen space. */
  dir: Pt;
  /** Inner-lip aperture in px — used when blendshapes are unavailable. */
  aperture: number;
  lipWidth: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Exponential smoothing that adapts to frame time, so signals feel the same on a
 * 30fps laptop and a 120Hz display.
 */
function ema(prev: number, next: number, halfLifeMs: number, dtMs: number) {
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return prev + (next - prev) * k;
}

export class SignalSmoother {
  private state: FaceSignals | null = null;

  reset() {
    this.state = null;
  }

  /**
   * Maps a raw face frame into mirrored screen pixels and smooths it. Positions
   * settle fast (jitter reads as a shaky cigarette); expression channels settle
   * a touch slower so a single noisy frame cannot fire a puff.
   */
  update(frame: FaceFrame, width: number, height: number, dtMs: number): FaceSignals {
    const lm = frame.landmarks;
    // The stage draws the camera mirrored, so screen x runs opposite to the model.
    const px = (i: number): Pt => {
      const p: NormalizedLandmark = lm[i];
      return { x: (1 - p.x) * width, y: p.y * height };
    };

    const inner = { top: px(IDX.lipInnerTop), bottom: px(IDX.lipInnerBottom) };
    const mouth = { x: (inner.top.x + inner.bottom.x) / 2, y: (inner.top.y + inner.bottom.y) / 2 };
    const cornerL = px(IDX.lipCornerL);
    const cornerR = px(IDX.lipCornerR);
    const eyeL = px(IDX.eyeOuterL);
    const eyeR = px(IDX.eyeOuterR);
    const chin = px(IDX.chin);
    const forehead = px(IDX.foreheadTop);
    const noseTip = px(IDX.noseTip);
    const noseBase = px(IDX.noseBase);

    // Yaw squashes the inter-ocular span, so keep a vertical yardstick in reserve.
    const scale = Math.max(dist(eyeL, eyeR), dist(forehead, chin) * 0.42, 1);

    // Nudge the jets a little below the nostril landmarks — smoke leaves the
    // underside of the nose, not the bridge.
    const drop = scale * 0.05;
    const nostrils: [Pt, Pt] = [
      { ...px(IDX.nostrilL), y: px(IDX.nostrilL).y + drop },
      { ...px(IDX.nostrilR), y: px(IDX.nostrilR).y + drop },
    ];

    const b = frame.blend;
    const aperture = dist(inner.top, inner.bottom);
    const lipWidth = dist(cornerL, cornerR);

    // Blendshapes are far steadier than raw lip geometry, but a model built
    // without them still has to work, hence the geometric fallbacks.
    const open = b.jawOpen !== undefined ? clamp01(b.jawOpen * 1.15) : clamp01(aperture / (scale * 0.42));
    const pucker = b.mouthPucker ?? clamp01(1 - lipWidth / (scale * 0.95));
    const funnel = b.mouthFunnel ?? 0;
    const cheeks = Math.max(b.cheekPuff ?? 0, ((b.cheekSquintLeft ?? 0) + (b.cheekSquintRight ?? 0)) * 0.15);
    const smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
    const browUp = b.browInnerUp ?? 0;

    // Head aim, read off the nose's drift from the face's own centre. This beats
    // decoding the transform matrix here: no basis conventions to get wrong, and
    // it degrades gracefully when the matrix is missing.
    const centre = { x: (eyeL.x + eyeR.x + chin.x) / 3, y: (eyeL.y + eyeR.y + chin.y) / 3 };
    const dir: Pt = {
      x: clampSigned((noseTip.x - centre.x) / (scale * 0.5)),
      y: clampSigned((noseTip.y - noseBase.y + scale * 0.06) / (scale * 0.35)),
    };

    const next: FaceSignals = {
      mouth,
      nostrils,
      chin,
      noseTip,
      scale,
      open,
      pucker,
      funnel,
      cheeks,
      smile,
      browUp,
      dir,
      aperture,
      lipWidth,
    };

    const prev = this.state;
    if (!prev) {
      this.state = next;
      return next;
    }

    const P = 26; // position half-life, ms
    const E = 45; // expression half-life, ms
    const merged: FaceSignals = {
      mouth: lerpPt(prev.mouth, next.mouth, P, dtMs),
      nostrils: [lerpPt(prev.nostrils[0], next.nostrils[0], P, dtMs), lerpPt(prev.nostrils[1], next.nostrils[1], P, dtMs)],
      chin: lerpPt(prev.chin, next.chin, P, dtMs),
      noseTip: lerpPt(prev.noseTip, next.noseTip, P, dtMs),
      scale: ema(prev.scale, next.scale, 90, dtMs),
      open: ema(prev.open, next.open, E, dtMs),
      pucker: ema(prev.pucker, next.pucker, E, dtMs),
      funnel: ema(prev.funnel, next.funnel, E, dtMs),
      cheeks: ema(prev.cheeks, next.cheeks, 70, dtMs),
      smile: ema(prev.smile, next.smile, E, dtMs),
      browUp: ema(prev.browUp, next.browUp, E, dtMs),
      dir: lerpPt(prev.dir, next.dir, 110, dtMs),
      aperture: ema(prev.aperture, next.aperture, E, dtMs),
      lipWidth: ema(prev.lipWidth, next.lipWidth, E, dtMs),
    };
    this.state = merged;
    return merged;
  }
}

function lerpPt(a: Pt, b: Pt, halfLifeMs: number, dtMs: number): Pt {
  return { x: ema(a.x, b.x, halfLifeMs, dtMs), y: ema(a.y, b.y, halfLifeMs, dtMs) };
}

function clampSigned(v: number) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
