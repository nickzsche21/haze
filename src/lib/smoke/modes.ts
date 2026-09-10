export type RGB = [number, number, number];

export interface SmokePreset {
  /** Velocity damping per second. High = the plume stops dead and billows. */
  drag: number;
  /** Curl-noise strength. */
  turbulence: number;
  /** Upward acceleration applied in proportion to a particle's heat. */
  buoyancy: number;
  /** Seconds for heat to fall by 1/e. Hot smoke rises; cold smoke hangs. */
  coolSec: number;
  /** How much a puff swells over its life. */
  grow: number;
  /** Fade-out exponent — higher dissolves later and faster. */
  fade: number;
  /** Particles emitted per unit of charge — i.e. the size of a full lungful. */
  rate: number;
  /** Base sprite radius in px, before growth. */
  size: number;
  lifeSec: number;
  jetSpeed: number;
  /** Per-particle opacity into the density buffer. */
  density: number;
}

export interface ModePalette {
  /** Colour of thin smoke and of thick smoke — the density ramp runs between them. */
  thin: RGB;
  thick: RGB;
  /** Rim colour picked up from the fake key light. */
  light: RGB;
  /** Additive glow colour; drives neon looks. */
  glow: RGB;
  glowAmount: number;
  ember: RGB;
}

export type PropKind = "cigarette" | "cigar" | "vape" | "joint" | "pipe" | "none";

export interface Mode {
  id: string;
  name: string;
  tagline: string;
  hint: string;
  prop: PropKind;
  accent: string;
  smoke: SmokePreset;
  palette: ModePalette;
  /** Sparks thrown on every exhale. */
  sparks: number;
  /** Idle wisp rising off the prop tip. */
  idleWisp: number;
}

const base: SmokePreset = {
  drag: 1.15,
  turbulence: 0.62,
  buoyancy: 0.5,
  coolSec: 1.5,
  grow: 3.0,
  fade: 1.5,
  rate: 2300,
  size: 21,
  lifeSec: 3.6,
  jetSpeed: 560,
  density: 0.2,
};

export const MODES: Mode[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "Unfiltered, 1962",
    hint: "Purse your lips to drag. Open wide to blow.",
    prop: "cigarette",
    accent: "#e8d9c0",
    smoke: { ...base },
    palette: {
      thin: [0.82, 0.83, 0.85],
      thick: [0.52, 0.53, 0.58],
      light: [1, 0.97, 0.9],
      glow: [0.6, 0.6, 0.65],
      glowAmount: 0.06,
      ember: [1, 0.42, 0.12],
    },
    sparks: 3,
    idleWisp: 1,
  },
  {
    id: "vape",
    name: "Cloud Chaser",
    tagline: "Absurd volume, zero shame",
    hint: "Long drag, then open wide. Chase the meter.",
    prop: "vape",
    accent: "#7dd3fc",
    smoke: {
      ...base,
      drag: 1.6,
      turbulence: 0.55,
      buoyancy: 0.3,
      grow: 3.7,
      rate: 3400,
      size: 26,
      lifeSec: 4.4,
      jetSpeed: 600,
      density: 0.24,
    },
    palette: {
      thin: [0.97, 0.98, 1],
      thick: [0.72, 0.78, 0.88],
      light: [1, 1, 1],
      glow: [0.55, 0.8, 1],
      glowAmount: 0.12,
      ember: [0.4, 0.85, 1],
    },
    sparks: 0,
    idleWisp: 0.35,
  },
  {
    id: "cuban",
    name: "Cuban",
    tagline: "Slow, thick, expensive",
    hint: "Hold it a beat longer. Let it hang.",
    prop: "cigar",
    accent: "#d8a657",
    smoke: {
      ...base,
      drag: 1.0,
      turbulence: 0.5,
      buoyancy: 0.4,
      coolSec: 2.4,
      grow: 2.6,
      rate: 2500,
      size: 25,
      lifeSec: 5.0,
      jetSpeed: 440,
      density: 0.24,
    },
    palette: {
      thin: [0.86, 0.82, 0.74],
      thick: [0.54, 0.47, 0.4],
      light: [1, 0.9, 0.72],
      glow: [0.8, 0.55, 0.2],
      glowAmount: 0.08,
      ember: [1, 0.5, 0.1],
    },
    sparks: 5,
    idleWisp: 1.4,
  },
  {
    id: "dragon",
    name: "Dragon",
    tagline: "Hold it in. Let it burn.",
    hint: "Drag, then keep your mouth shut. It finds the nose.",
    prop: "none",
    accent: "#ff7a3c",
    smoke: {
      ...base,
      drag: 1.2,
      turbulence: 1.0,
      buoyancy: 1.0,
      coolSec: 0.85,
      grow: 3.2,
      rate: 2600,
      size: 22,
      lifeSec: 2.9,
      jetSpeed: 640,
      density: 0.22,
    },
    palette: {
      thin: [1, 0.7, 0.3],
      thick: [0.62, 0.2, 0.08],
      light: [1, 0.85, 0.45],
      glow: [1, 0.42, 0.08],
      glowAmount: 0.5,
      ember: [1, 0.75, 0.2],
    },
    sparks: 16,
    idleWisp: 0,
  },
  {
    id: "neon",
    name: "Neon",
    tagline: "Blade Runner, but it's your kitchen",
    hint: "Make an O with your lips to fire rings.",
    prop: "vape",
    accent: "#ff4fd8",
    smoke: {
      ...base,
      drag: 1.3,
      turbulence: 0.7,
      buoyancy: 0.45,
      grow: 3.1,
      rate: 2800,
      size: 23,
      lifeSec: 4.0,
      jetSpeed: 580,
      density: 0.21,
    },
    palette: {
      thin: [1, 0.45, 0.9],
      thick: [0.3, 0.1, 0.52],
      light: [0.5, 0.95, 1],
      glow: [1, 0.25, 0.85],
      glowAmount: 0.62,
      ember: [0.4, 1, 0.95],
    },
    sparks: 6,
    idleWisp: 0.5,
  },
  {
    id: "toxic",
    name: "Toxic",
    tagline: "Definitely not FDA approved",
    hint: "Rings look best in this one. Funnel those lips.",
    prop: "pipe",
    accent: "#a3e635",
    smoke: {
      ...base,
      drag: 1.25,
      turbulence: 0.85,
      buoyancy: 0.5,
      grow: 3.0,
      rate: 2600,
      size: 22,
      lifeSec: 3.8,
      jetSpeed: 560,
      density: 0.21,
    },
    palette: {
      thin: [0.75, 1, 0.35],
      thick: [0.16, 0.42, 0.08],
      light: [0.9, 1, 0.6],
      glow: [0.5, 1, 0.15],
      glowAmount: 0.4,
      ember: [0.7, 1, 0.2],
    },
    sparks: 8,
    idleWisp: 0.8,
  },
  {
    id: "frost",
    name: "Frostbite",
    tagline: "Minus forty, indoors",
    hint: "No prop, no lighter. Just breathe out slow.",
    prop: "none",
    accent: "#bae6fd",
    smoke: {
      ...base,
      drag: 1.9,
      turbulence: 0.45,
      buoyancy: 0.18,
      coolSec: 3.2,
      grow: 2.5,
      rate: 1800,
      size: 21,
      lifeSec: 3.0,
      jetSpeed: 450,
      density: 0.17,
    },
    palette: {
      thin: [0.92, 0.98, 1],
      thick: [0.6, 0.75, 0.9],
      light: [1, 1, 1],
      glow: [0.6, 0.85, 1],
      glowAmount: 0.18,
      ember: [0.7, 0.9, 1],
    },
    sparks: 0,
    idleWisp: 0,
  },
  {
    id: "ink",
    name: "Ink",
    tagline: "Squid defence mechanism",
    hint: "Blow hard. It swallows the room.",
    prop: "joint",
    accent: "#8b5cf6",
    smoke: {
      ...base,
      drag: 1.05,
      turbulence: 0.8,
      buoyancy: 0.28,
      coolSec: 2.6,
      grow: 3.5,
      rate: 3200,
      size: 26,
      lifeSec: 4.8,
      jetSpeed: 520,
      density: 0.27,
    },
    palette: {
      thin: [0.42, 0.3, 0.62],
      thick: [0.1, 0.06, 0.18],
      light: [0.7, 0.55, 1],
      glow: [0.35, 0.15, 0.7],
      glowAmount: 0.22,
      ember: [0.85, 0.5, 1],
    },
    sparks: 4,
    idleWisp: 0.9,
  },
];

export const DEFAULT_MODE = MODES[0];

export function modeById(id: string): Mode {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE;
}
