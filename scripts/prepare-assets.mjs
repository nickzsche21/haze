/**
 * Stages the vision runtime into public/ before dev + build.
 *
 * The WASM is copied out of node_modules so it can never drift from the
 * installed @mediapipe/tasks-vision version. Models come from Google's bucket.
 * Both are gitignored; if a download fails the client falls back to the CDN at
 * runtime, so a flaky build network is never fatal.
 */
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();

const MODELS = [
  {
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    dest: path.join(root, "public", "models", "face_landmarker.task"),
    minBytes: 1_000_000,
  },
  {
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    dest: path.join(root, "public", "models", "hand_landmarker.task"),
    minBytes: 1_000_000,
  },
];

async function copyWasm() {
  // The package does not export ./package.json, so resolve the main entry.
  const pkg = path.dirname(require.resolve("@mediapipe/tasks-vision"));
  const src = path.join(pkg, "wasm");
  const dest = path.join(root, "public", "mediapipe", "wasm");
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log("[assets] wasm staged from", path.relative(root, src));
}

async function fetchModel({ url, dest, minBytes }) {
  const name = path.basename(dest);
  try {
    const s = await stat(dest);
    if (s.size > minBytes) {
      console.log(`[assets] ${name} already present`);
      return;
    }
  } catch {
    /* not staged yet */
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`[assets] ${name} downloaded (${(buf.length / 1e6).toFixed(1)} MB)`);
}

await copyWasm();
for (const model of MODELS) {
  try {
    await fetchModel(model);
  } catch (err) {
    console.warn(`[assets] ${path.basename(model.dest)} failed, CDN fallback will cover it:`, err.message);
  }
}
