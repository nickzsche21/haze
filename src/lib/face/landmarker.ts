import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const LOCAL_WASM = "/mediapipe/wasm";
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const FACE_LOCAL = "/models/face_landmarker.task";
const FACE_CDN =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_LOCAL = "/models/hand_landmarker.task";
const HAND_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type Blendshapes = Record<string, number>;

export interface FaceFrame {
  landmarks: NormalizedLandmark[];
  blend: Blendshapes;
  /** Face-local axes in world space, from the transformation matrix (may be null). */
  matrix: Float32Array | null;
}

export interface HandFrame {
  landmarks: NormalizedLandmark[];
  /** "Left" / "Right" as MediaPipe labels it on the *unmirrored* image. */
  handedness: string;
  score: number;
}

export interface Vision {
  face: FaceLandmarker;
  hands: HandLandmarker | null;
  close(): void;
}

async function reachable(url: string) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

let cached: Vision | null = null;
let loading: Promise<Vision> | null = null;

/**
 * Loads the vision models once per page. Prefers same-origin copies staged by
 * scripts/prepare-assets.mjs, falling back to the public CDN so a fresh clone
 * without a build step still runs.
 */
export async function loadVision(opts: { hands: boolean }): Promise<Vision> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const local = await reachable(FACE_LOCAL);
    const fileset = await FilesetResolver.forVisionTasks(local ? LOCAL_WASM : CDN_WASM);

    const buildFace = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: local ? FACE_LOCAL : FACE_CDN, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let face: FaceLandmarker;
    try {
      face = await buildFace("GPU");
    } catch {
      // Locked-down browsers and some integrated GPUs refuse the GPU delegate.
      face = await buildFace("CPU");
    }

    let hands: HandLandmarker | null = null;
    if (opts.hands) {
      try {
        hands = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: local ? HAND_LOCAL : HAND_CDN, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        // The prop is a garnish — losing it must not cost anyone the smoke.
        hands = null;
      }
    }

    cached = {
      face,
      hands,
      close() {
        face.close();
        hands?.close();
        cached = null;
        loading = null;
      },
    };
    return cached;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

export function readFace(lm: FaceLandmarker, video: HTMLVideoElement, tMs: number): FaceFrame | null {
  const res = lm.detectForVideo(video, tMs);
  const landmarks = res.faceLandmarks?.[0];
  if (!landmarks || landmarks.length === 0) return null;

  const blend: Blendshapes = {};
  for (const cat of res.faceBlendshapes?.[0]?.categories ?? []) {
    if (cat.categoryName) blend[cat.categoryName] = cat.score;
  }

  const raw = res.facialTransformationMatrixes?.[0]?.data;
  return { landmarks, blend, matrix: raw ? new Float32Array(raw) : null };
}

export function readHand(lm: HandLandmarker, video: HTMLVideoElement, tMs: number): HandFrame | null {
  const res = lm.detectForVideo(video, tMs);
  const landmarks = res.landmarks?.[0];
  if (!landmarks || landmarks.length === 0) return null;
  const h = res.handedness?.[0]?.[0];
  return { landmarks, handedness: h?.categoryName ?? "Right", score: h?.score ?? 0 };
}
