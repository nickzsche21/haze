export interface Clip {
  url: string;
  blob: Blob;
  ms: number;
}

const CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/**
 * Records the composite canvas.
 *
 * Safari only speaks mp4 here and Chrome prefers webm, so the container is
 * whatever the browser will actually give us rather than a hardcoded guess.
 */
export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private mime = "";

  static supported() {
    return typeof MediaRecorder !== "undefined" && CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
  }

  get recording() {
    return this.rec?.state === "recording";
  }

  start(canvas: HTMLCanvasElement, fps = 30) {
    if (this.recording) return;
    this.mime = CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const stream = canvas.captureStream(fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 8_000_000 } : undefined);
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = performance.now();
    this.rec.start(100);
  }

  stop(): Promise<Clip | null> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime || "video/webm" });
        this.rec = null;
        resolve(blob.size > 0 ? { url: URL.createObjectURL(blob), blob, ms: performance.now() - this.startedAt } : null);
      };
      rec.stop();
    });
  }

  get extension() {
    return this.mime.startsWith("video/mp4") ? "mp4" : "webm";
  }
}
