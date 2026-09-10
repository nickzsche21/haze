# HAZE

Virtual smoke, driven by your actual breath. Point a webcam at your face, purse
your lips, hold it, and blow — the cloud that comes out is simulated in real
time and goes wherever you aim your head.

Everything runs on-device. The camera feed is read, drawn and discarded inside
the page; nothing is uploaded, nothing is stored, there is no account, and there
is no tobacco.

## What makes it different

Most "smoking filter" effects trigger a canned puff animation when your mouth
opens. HAZE models the breath instead, and the tricks fall out of the physics.

**Breath, not gestures.** The face mesh gives 52 ARKit blendshapes, and four of
them carry the whole interaction: `mouthPucker` loads charge, `cheekPuff` holds
it, `jawOpen` spends it, `mouthFunnel` shapes it into a ring. Because charge is
a real quantity, a wide mouth dumps the lot in a fast thin jet while a narrow one
feathers the same lungful out as a slow fat cloud.

**Airflow runs both ways.** Pursed lips don't just stop the smoke — they pull it
back. The nose quietly drinks anything slow drifting up past it. So a ghost
inhale is genuinely the smoke returning to your mouth, and a French inhale
happens because you exhaled gently enough for your nose to catch it. Neither is
scripted; the trick detector only names what the simulation already did.

**Volumetric shading.** Particles accumulate into a half-resolution density
buffer, then one fullscreen pass differentiates that buffer to fake a surface
normal and lights it against a fixed key. Thick smoke self-shades, thin edges
catch a rim, and the whole thing costs a single extra pass.

**A cigarette in your hand.** Hand tracking puts the prop between your index and
middle fingers with an ember that brightens as you drag and throws a warm bounce
light into nearby smoke. Lose the hand and it falls back to dangling from your
lip, so tracking is never load-bearing.

## Tricks

| Trick | How |
| --- | --- |
| Smoke ring | Hold it, then push your lips into a tight O |
| Dragon | Take a drag and simply don't open your mouth |
| Ghost inhale | Blow a cloud, then purse up and suck it back |
| French inhale | Exhale slow and let it drift up past your nose |
| Big cloud | Long drag, wide open |

Eight flavours — Classic, Cloud Chaser, Cuban, Dragon, Neon, Toxic, Frostbite
and Ink — each with its own physics and palette. Hit Record to capture a clip
with the score and trick callouts burned in.

## Running it

```bash
npm install
npm run dev
```

`predev` and `prebuild` stage the MediaPipe WASM out of `node_modules` and
download the face and hand models into `public/`. Both are gitignored, and the
client falls back to the public CDN if either is missing, so a fresh clone with
no build step still runs.

Needs WebGL2 and a camera. Chrome, Edge and Safari 17+ are fine.

## How it fits together

```
camera ─→ FaceLandmarker ─→ signals ─→ BreathEngine ─→ emissions
                                            │              │
                                            │              ▼
                                       attractors ──→ ParticleSystem
                                                           │
                                            density buffer ▼
                                       SmokeRenderer ─→ shade pass ─→ canvas
```

- `lib/face/signals.ts` — landmarks and blendshapes into smoothed, mirrored,
  screen-space signals
- `lib/smoke/breath.ts` — the drag/hold/exhale state machine and the attractors
- `lib/smoke/particles.ts` — flat typed arrays, swap-removal, curl-noise
  turbulence; a full frame allocates nothing
- `lib/gl/renderer.ts` — instanced density accumulation plus the shading pass
- `lib/engine.ts` — the loop, and the composite canvas that feeds the recorder

`Engine.frameAt(now)` is deliberately separate from the rAF callback so the
whole pipeline can be driven at a fixed step without a live clock — browsers
suspend rAF in a hidden tab, which otherwise makes the renderer impossible to
exercise headlessly. `lib/demo.ts` uses that to run synthetic breath for the
landing preview.

## Licence

MIT.
