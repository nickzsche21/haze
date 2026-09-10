import type { FaceSignals } from "./face/signals";

/**
 * Synthetic breath, for the preview that plays before anyone grants camera
 * access — and, usefully, a way to exercise the whole pipeline without a face.
 *
 * It drives the same FaceSignals the tracker produces, so the demo runs through
 * the real state machine rather than replaying a canned animation.
 */
const CYCLE = 7.2;

export function demoSignals(tSec: number, w: number, h: number): FaceSignals {
  const scale = h * 0.2;
  const sway = Math.sin(tSec * 0.31);
  const bob = Math.sin(tSec * 0.47 + 1.1);

  const cx = w * 0.5 + sway * w * 0.045;
  const cy = h * 0.56 + bob * h * 0.02;

  const cycle = Math.floor(tSec / CYCLE);
  const t = tSec % CYCLE;
  const flavour = cycle % 4; // 0,2 = plain blow · 1 = ring · 3 = dragon

  let pucker = 0.05;
  let open = 0.02;
  let funnel = 0;

  if (t < 1.9) {
    // Drag: purse up and draw.
    pucker = 0.15 + 0.62 * smooth(t / 1.9);
  } else if (t < 2.6) {
    pucker = 0.62 * (1 - smooth((t - 1.9) / 0.6));
  } else if (flavour === 3) {
    // Dragon: mouth stays shut past the hold limit and the engine vents it
    // through the nose on its own.
    pucker = 0.06;
  } else if (t < 4.2) {
    const u = (t - 2.6) / 1.6;
    if (flavour === 1) {
      funnel = 0.74 * bell(u);
      open = 0.17 + 0.13 * bell(u);
    } else {
      open = 0.64 * bell(u);
    }
  } else if (flavour === 2 && t < 5.1) {
    // Ghost inhale: take it back.
    pucker = 0.72 * bell((t - 4.2) / 0.9);
  }

  const mouth = { x: cx, y: cy + scale * 0.42 };
  return {
    mouth,
    nostrils: [
      { x: cx - scale * 0.14, y: cy + scale * 0.1 },
      { x: cx + scale * 0.14, y: cy + scale * 0.1 },
    ],
    chin: { x: cx, y: cy + scale * 0.85 },
    noseTip: { x: cx + sway * scale * 0.12, y: cy - scale * 0.02 },
    scale,
    open,
    pucker,
    funnel,
    cheeks: 0,
    smile: 0,
    browUp: 0,
    dir: { x: sway * 0.5, y: -0.1 + bob * 0.15 },
    aperture: open * scale * 0.42,
    lipWidth: scale * 0.75,
  };
}

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

const bell = (t: number) => {
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(t * Math.PI) ** 1.4;
};
