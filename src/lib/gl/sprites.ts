/**
 * Builds the smoke sprite atlas: a 2x2 sheet of fbm-textured puffs.
 *
 * Four variants is enough that overlapping sprites stop reading as repeated
 * circles, and baking them once beats evaluating noise per fragment across
 * thousands of large, heavily overdrawn quads.
 */
const TILE = 128;

function hash2(x: number, y: number, seed: number) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

function fbm(x: number, y: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 5; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 37) * amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum;
}

export function buildSmokeAtlas(): HTMLCanvasElement {
  const size = TILE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * TILE;
    const oy = Math.floor(tile / 2) * TILE;
    const seed = 11 + tile * 97;

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const nx = (x / TILE) * 2 - 1;
        const ny = (y / TILE) * 2 - 1;
        const r = Math.hypot(nx, ny);

        // Warp the sample point so the blob has lumpy edges rather than a
        // circle wearing a noise texture.
        const wx = nx + (fbm(nx * 2.1 + 5, ny * 2.1, seed + 3) - 0.5) * 0.55;
        const wy = ny + (fbm(nx * 2.1, ny * 2.1 + 5, seed + 9) - 0.5) * 0.55;
        const detail = fbm(wx * 2.6 + 3, wy * 2.6 + 3, seed);

        const falloff = Math.max(0, 1 - r);
        let a = Math.pow(falloff, 1.55) * (0.35 + 0.95 * detail);
        a *= smoothstep(Math.min(1, (1 - r) * 2.6));
        a = Math.max(0, Math.min(1, a));

        const i = ((oy + y) * size + (ox + x)) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(a * 255);
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}
