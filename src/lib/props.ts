import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FaceSignals, Pt } from "./face/signals";
import type { Mode, PropKind, RGB } from "./smoke/modes";

export interface PropPlacement {
  /** Where the prop is gripped. */
  anchor: Pt;
  angle: number;
  length: number;
  /** The burning end, in canvas px — smoke and the bounce light start here. */
  tip: Pt;
  fromHand: boolean;
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const HAND = { wrist: 0, indexMcp: 5, indexPip: 6, indexTip: 8, middleMcp: 9, middlePip: 10, middleTip: 12 };

/**
 * Puts the prop between the index and middle fingers when a hand is visible,
 * and parks it in the corner of the mouth when one isn't — a dangling cigarette
 * is a perfectly good look, and it means hand tracking is never load-bearing.
 */
export function placeProp(
  hand: NormalizedLandmark[] | null,
  face: FaceSignals,
  width: number,
  height: number,
): PropPlacement {
  const length = face.scale * 1.05;

  if (hand) {
    const px = (i: number): Pt => ({ x: (1 - hand[i].x) * width, y: hand[i].y * height });
    const pipMid = mid(px(HAND.indexPip), px(HAND.middlePip));
    const mcpMid = mid(px(HAND.indexMcp), px(HAND.middleMcp));
    const tipMid = mid(px(HAND.indexTip), px(HAND.middleTip));
    const handSpan = Math.hypot(px(HAND.wrist).x - px(HAND.middleMcp).x, px(HAND.wrist).y - px(HAND.middleMcp).y);
    const angle = Math.atan2(tipMid.y - mcpMid.y, tipMid.x - mcpMid.x);
    const len = Math.max(length * 0.8, handSpan * 1.25);
    return {
      anchor: pipMid,
      angle,
      length: len,
      tip: { x: pipMid.x + Math.cos(angle) * len * 0.68, y: pipMid.y + Math.sin(angle) * len * 0.68 },
      fromHand: true,
    };
  }

  // Dangling: out of the corner of the mouth, tipped down, on whichever side the
  // head is turned away from so it never crosses the face.
  const side = face.dir.x >= 0 ? -1 : 1;
  const anchor = { x: face.mouth.x + side * face.scale * 0.34, y: face.mouth.y + face.scale * 0.06 };
  const angle = side < 0 ? Math.PI - 0.42 : 0.42;
  return {
    anchor,
    angle,
    length,
    tip: { x: anchor.x + Math.cos(angle) * length * 0.68, y: anchor.y + Math.sin(angle) * length * 0.68 },
    fromHand: false,
  };
}

const rgb = (c: RGB, a = 1) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;

export function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: PropKind,
  place: PropPlacement,
  mode: Mode,
  ember: number,
) {
  if (kind === "none") return;
  const L = place.length;

  ctx.save();
  ctx.translate(place.anchor.x, place.anchor.y);
  ctx.rotate(place.angle);
  ctx.translate(-L * 0.32, 0);

  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = L * 0.05;
  ctx.shadowOffsetY = L * 0.02;

  switch (kind) {
    case "cigarette":
      cigarette(ctx, L, ember);
      break;
    case "cigar":
      cigar(ctx, L, ember);
      break;
    case "vape":
      vape(ctx, L, ember, mode);
      break;
    case "joint":
      joint(ctx, L, ember);
      break;
    case "pipe":
      pipe(ctx, L, ember, mode);
      break;
  }
  ctx.restore();

  if (ember > 0.02 && kind !== "vape") glow(ctx, place.tip, L * (0.16 + 0.14 * ember), mode.palette.ember, ember);
}

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function cigarette(ctx: CanvasRenderingContext2D, L: number, ember: number) {
  const h = L * 0.085;
  const y = -h / 2;

  const paper = ctx.createLinearGradient(0, y, 0, y + h);
  paper.addColorStop(0, "#ffffff");
  paper.addColorStop(0.45, "#f2efe8");
  paper.addColorStop(1, "#c9c3b8");
  ctx.fillStyle = paper;
  roundedBar(ctx, L * 0.3, y, L * 0.7, h, h * 0.22);
  ctx.shadowColor = "transparent";

  const filter = ctx.createLinearGradient(0, y, 0, y + h);
  filter.addColorStop(0, "#e7bd7c");
  filter.addColorStop(0.5, "#d19f56");
  filter.addColorStop(1, "#a97b3a");
  ctx.fillStyle = filter;
  roundedBar(ctx, 0, y, L * 0.32, h, h * 0.22);

  ctx.fillStyle = "rgba(140,96,42,0.55)";
  ctx.fillRect(L * 0.29, y, L * 0.012, h);

  // Ash at the burning end: pale, cracked, and it recedes as the ember flares.
  const ashLen = L * 0.09 * (1 - ember * 0.35);
  const ash = ctx.createLinearGradient(L - ashLen, 0, L, 0);
  ash.addColorStop(0, "#8d8a86");
  ash.addColorStop(1, "#4a4744");
  ctx.fillStyle = ash;
  ctx.fillRect(L - ashLen, y, ashLen, h);

  if (ember > 0.02) {
    const e = ctx.createLinearGradient(L - ashLen * 1.1, 0, L, 0);
    e.addColorStop(0, `rgba(255,80,10,0)`);
    e.addColorStop(1, `rgba(255,${(120 + 90 * ember) | 0},30,${0.55 + 0.45 * ember})`);
    ctx.fillStyle = e;
    ctx.fillRect(L - ashLen * 1.1, y, ashLen * 1.1, h);
  }
}

function cigar(ctx: CanvasRenderingContext2D, L: number, ember: number) {
  const h = L * 0.15;
  ctx.beginPath();
  ctx.ellipse(L * 0.5, 0, L * 0.5, h / 2, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, "#8a5a2b");
  g.addColorStop(0.4, "#6b4220");
  g.addColorStop(1, "#3d2412");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.fillStyle = "#d8a657";
  ctx.beginPath();
  ctx.ellipse(L * 0.2, 0, L * 0.05, h * 0.47, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(60,40,10,0.5)";
  ctx.fillRect(L * 0.18, -h * 0.05, L * 0.04, h * 0.1);

  ctx.beginPath();
  ctx.ellipse(L * 0.97, 0, L * 0.035, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = ember > 0.02 ? `rgba(255,${(90 + 100 * ember) | 0},20,${0.6 + 0.4 * ember})` : "#5c5854";
  ctx.fill();
}

function vape(ctx: CanvasRenderingContext2D, L: number, ember: number, mode: Mode) {
  const h = L * 0.2;
  const y = -h / 2;
  ctx.fillStyle = "#1a1d24";
  roundedBar(ctx, 0, y, L * 0.72, h, h * 0.3);
  ctx.shadowColor = "transparent";

  const sheen = ctx.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sheen;
  roundedBar(ctx, 0, y, L * 0.72, h, h * 0.3);

  ctx.fillStyle = "#0c0e12";
  roundedBar(ctx, L * 0.7, -h * 0.28, L * 0.16, h * 0.56, h * 0.2);

  ctx.fillStyle = rgb(mode.palette.glow, 0.25 + 0.75 * ember);
  roundedBar(ctx, L * 0.08, h * 0.18, L * 0.5, h * 0.12, h * 0.06);
  if (ember > 0.02) glowRect(ctx, L * 0.08, h * 0.18, L * 0.5, h * 0.12, mode.palette.glow, ember);
}

function joint(ctx: CanvasRenderingContext2D, L: number, ember: number) {
  const hButt = L * 0.055;
  const hTip = L * 0.1;
  ctx.beginPath();
  ctx.moveTo(0, -hButt / 2);
  ctx.lineTo(L, -hTip / 2);
  ctx.lineTo(L, hTip / 2);
  ctx.lineTo(0, hButt / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -hTip / 2, 0, hTip / 2);
  g.addColorStop(0, "#fbf7ec");
  g.addColorStop(0.5, "#eee6d2");
  g.addColorStop(1, "#bfb49a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = "rgba(150,135,100,0.5)";
  ctx.lineWidth = Math.max(1, L * 0.006);
  ctx.beginPath();
  ctx.moveTo(L * 0.26, -hButt * 0.6);
  ctx.lineTo(L * 0.3, hButt * 0.7);
  ctx.stroke();

  ctx.fillStyle = ember > 0.02 ? `rgba(255,${(95 + 95 * ember) | 0},25,${0.6 + 0.4 * ember})` : "#4d4a46";
  ctx.fillRect(L * 0.94, -hTip / 2, L * 0.06, hTip);
}

function pipe(ctx: CanvasRenderingContext2D, L: number, ember: number, mode: Mode) {
  const h = L * 0.07;
  ctx.fillStyle = "rgba(190,215,225,0.55)";
  roundedBar(ctx, 0, -h / 2, L * 0.72, h, h * 0.5);
  ctx.shadowColor = "transparent";

  ctx.beginPath();
  ctx.arc(L * 0.82, 0, L * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(180,205,220,0.5)";
  ctx.fill();
  ctx.strokeStyle = "rgba(240,250,255,0.7)";
  ctx.lineWidth = Math.max(1, L * 0.008);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(L * 0.82, 0, L * 0.085, 0, Math.PI * 2);
  ctx.fillStyle = rgb(mode.palette.ember, 0.25 + 0.6 * ember);
  ctx.fill();
  if (ember > 0.02) glow(ctx, { x: L * 0.82, y: 0 }, L * 0.3, mode.palette.ember, ember * 0.8);
}

function glow(ctx: CanvasRenderingContext2D, at: Pt, r: number, color: RGB, intensity: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
  g.addColorStop(0, rgb(color, 0.75 * intensity));
  g.addColorStop(0.35, rgb(color, 0.28 * intensity));
  g.addColorStop(1, rgb(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function glowRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: RGB, intensity: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = rgb(color, 0.9);
  ctx.shadowBlur = h * 6;
  ctx.fillStyle = rgb(color, 0.55 * intensity);
  roundedBar(ctx, x, y, w, h, h * 0.5);
  ctx.restore();
}
