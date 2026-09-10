"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, type EngineStatus, type HudStats } from "@/lib/engine";
import { ClipRecorder, type Clip } from "@/lib/recorder";
import { DEFAULT_MODE, MODES, type Mode } from "@/lib/smoke/modes";
import type { TrickEvent } from "@/lib/smoke/tricks";

const TRICKS = [
  ["Smoke ring", "Hold it, then push your lips into a tight O"],
  ["Dragon", "Take a drag and just… don't open your mouth"],
  ["Ghost inhale", "Blow a cloud, then purse up and suck it back"],
  ["French inhale", "Exhale slow — let it drift up past your nose"],
  ["Big cloud", "Long drag, wide open, no regrets"],
];

const EMPTY: HudStats = {
  fps: 0,
  phase: "idle",
  charge: 0,
  cloud: 0,
  bestCloud: 0,
  score: 0,
  combo: 0,
  particles: 0,
  faceFound: false,
  handFound: false,
  quality: 1,
};

const PHASE_LABEL: Record<HudStats["phase"], string> = {
  idle: "ready",
  drag: "drawing",
  hold: "holding",
  exhale: "exhaling",
};

export default function Studio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const recTimer = useRef<number | null>(null);

  const [status, setStatus] = useState<EngineStatus>("idle");
  const [detail, setDetail] = useState<string>("");
  const [stats, setStats] = useState<HudStats>(EMPTY);
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [muted, setMuted] = useState(false);
  const [showProp, setShowProp] = useState(true);
  const [lite, setLite] = useState(false);
  const [ticks, setTicks] = useState<TrickEvent[]>([]);
  const [recording, setRecording] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [preview, setPreview] = useState(false);
  const [diag, setDiag] = useState(false);

  // Resolved after mount: MediaRecorder support is a client-only fact, and
  // deciding it during render desynchronises the server HTML.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => setCanRecord(ClipRecorder.supported()), []);

  // The whole page is themed off the active mode, so the room glows the colour
  // of whatever you are smoking.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", mode.accent);
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setShowProp(showProp);
  }, [showProp]);

  useEffect(() => {
    engineRef.current?.sfx.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    engineRef.current?.setDiagnostics(diag);
  }, [diag]);

  // "D" surfaces the raw expression channels — the fastest way to find out why
  // a face is not triggering a drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      setDiag((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Run the synthetic-breath preview the moment the page loads, so the first
  // thing anyone sees is smoke rather than a permission prompt.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || engineRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let engine: Engine;
    try {
      engine = new Engine(video, canvas, { onStatus: () => {}, onStats: () => {}, onTrick: () => {} });
    } catch {
      return; // no 2D context — the pre-roll copy still stands on its own
    }
    engineRef.current = engine;
    if (process.env.NODE_ENV !== "production") {
      const w = window as unknown as { __haze?: unknown; __hazeModes?: unknown };
      w.__haze = engine;
      w.__hazeModes = MODES;
    }
    engine.setMode(DEFAULT_MODE);
    engine.setShowProp(false);
    engine.sfx.setMuted(true);
    void engine.start({ hands: false, demo: true });
    setPreview(true);

    return () => {
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
      setPreview(false);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recTimer.current) window.clearTimeout(recTimer.current);
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const onTrick = useCallback((t: TrickEvent) => {
    setTicks((prev) => [t, ...prev].slice(0, 5));
  }, []);

  const start = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Hand the stage over from the preview to the real thing.
    engineRef.current?.stop();
    engineRef.current = null;
    setPreview(false);

    setStatus("starting");
    setDetail("Waking the camera");
    const engine = new Engine(video, canvas, {
      onStatus: (s, d) => {
        setStatus(s);
        setDetail(d ?? "");
      },
      onStats: setStats,
      onTrick,
    });
    engineRef.current = engine;
    engine.setMode(mode);
    engine.setShowProp(showProp);
    // Audio has to be unlocked inside the click that started all this.
    await engine.sfx.enable().catch(() => undefined);
    engine.sfx.setMuted(muted);
    await engine.start({ hands: !lite });
  }, [mode, showProp, muted, lite, onTrick]);

  const toggleRecord = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rec = (recorderRef.current ??= new ClipRecorder());

    if (rec.recording) {
      if (recTimer.current) window.clearTimeout(recTimer.current);
      setRecording(false);
      const out = await rec.stop();
      if (out) setClip(out);
      return;
    }

    setClip(null);
    rec.start(canvas);
    setRecording(true);
    // A hard cap keeps a forgotten recording from eating the tab's memory.
    recTimer.current = window.setTimeout(async () => {
      setRecording(false);
      const out = await rec.stop();
      if (out) setClip(out);
    }, 20_000);
  }, []);

  const running = status === "running";
  const live = running && stats.faceFound;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="dot" aria-hidden />
          <h1>HAZE</h1>
          <p>Virtual smoke, driven by your actual breath.</p>
        </div>

        <div className="toolbar">
          <button className="tool" data-on={!muted} onClick={() => setMuted((m) => !m)} disabled={!running}>
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button className="tool" data-on={showProp} onClick={() => setShowProp((p) => !p)} disabled={!running}>
            Prop
          </button>
          <button className="tool" onClick={() => engineRef.current?.clearSmoke()} disabled={!running}>
            Clear
          </button>
          <button className="tool" data-on={diag} onClick={() => setDiag((d) => !d)} disabled={!running} title="Show the raw face signals (D)">
            Signals
          </button>
          {canRecord && (
            <button className="tool" data-rec={recording} onClick={toggleRecord} disabled={!running}>
              {recording ? "Stop" : "Record"}
            </button>
          )}
        </div>
      </header>

      <div className="stage-wrap">
        <div className="stage">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} width={1280} height={720} />

          {running && (
            <>
              <div className="statusdot">
                <span className="pill" data-live={stats.faceFound}>
                  <i />
                  {stats.faceFound ? PHASE_LABEL[stats.phase] : "no face"}
                </span>
                <span className="pill mono">{stats.fps} fps</span>
                {stats.handFound && <span className="pill">hand</span>}
              </div>

              <div className="hud">
                <div className="meters">
                  <div>
                    <div className="meter-head">
                      <span className="label">Lungs</span>
                      <span className="mono">{Math.round(stats.charge * 100)}%</span>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${stats.charge * 100}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="meter-head">
                      <span className="label">Cloud</span>
                      <span className="mono">best {Math.round(stats.bestCloud * 100)}</span>
                    </div>
                    <div className="bar cloud">
                      <i style={{ width: `${stats.cloud * 100}%` }} />
                      {stats.bestCloud > 0.02 && (
                        <div className="ghost" style={{ marginLeft: `${Math.min(99, stats.bestCloud * 100)}%` }} />
                      )}
                    </div>
                  </div>
                </div>

                <div className="scorebox">
                  <span className="label">Score</span>
                  <span className="n mono">{stats.score.toLocaleString()}</span>
                  <span className="combo" data-on={stats.combo > 1}>
                    COMBO ×{stats.combo}
                  </span>
                </div>
              </div>
            </>
          )}

          {preview && !running && (
            <div className="statusdot">
              <span className="pill">preview · no camera yet</span>
            </div>
          )}

          {!running && (
            <div className="preroll">
              <div className="preroll-inner">
                <h2>
                  Blow smoke
                  <br />
                  without the smoke.
                </h2>
                <p className="sub">
                  Your webcam reads your lips, cheeks and jaw. Purse up to take a drag, hold it, then let it go — the
                  cloud that comes out is simulated in real time, and it goes wherever you aim your head.
                </p>

                <div className="steps">
                  <span className="step">
                    <b>1</b> Purse your lips
                  </span>
                  <span className="step">
                    <b>2</b> Hold it in
                  </span>
                  <span className="step">
                    <b>3</b> Open up and blow
                  </span>
                </div>

                {status === "error" ? (
                  <div className="errorbox">{detail}</div>
                ) : (
                  <button className="cta" onClick={start} disabled={status === "starting"}>
                    {status === "starting" ? detail || "Starting…" : "Start camera"}
                  </button>
                )}

                <label className="step" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={lite}
                    onChange={(e) => setLite(e.target.checked)}
                    disabled={status === "starting"}
                  />
                  Lite mode — skip hand tracking on a slower machine
                </label>

                <p className="fineprint">
                  The camera feed is processed entirely on this device and never leaves it. Nothing is uploaded, nothing
                  is stored, and there is no account. Also: nobody inhaled anything. That is rather the point.
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="card">
            <span className="label">Flavour</span>
            <div className="modes">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className="mode"
                  data-on={m.id === mode.id}
                  style={{ ["--mode" as string]: m.accent }}
                  onClick={() => setMode(m)}
                >
                  <span className="swatch" />
                  <b>{m.name}</b>
                  <span>{m.tagline}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <span className="label">Now playing</span>
            <p className="hint">
              <b>{mode.name}.</b> {mode.hint}
            </p>
            <p className="hint" style={{ marginTop: 8 }}>
              Not triggering? Press <b>D</b> for the raw face signals and see which one is falling short.
            </p>
          </div>

          <div className="card">
            <span className="label">Landed</span>
            <div className="ticker">
              {ticks.length === 0 ? (
                <p className="empty">Nothing yet. Take a drag and hold it — the app names what it sees.</p>
              ) : (
                ticks.map((t) => (
                  <div className="tick" key={t.id}>
                    <b>{t.name}</b>
                    <span className="note">{t.note}</span>
                    <span className="pts">+{t.points}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <span className="label">Tricks</span>
            <div className="tricklist">
              {TRICKS.map(([name, how]) => (
                <div className="trickrow" key={name}>
                  <b>{name}</b>
                  <span>{how}</span>
                </div>
              ))}
            </div>
          </div>

          {clip && (
            <div className="card clipbar">
              <span>Clip ready ({(clip.ms / 1000).toFixed(1)}s)</span>
              <a href={clip.url} download={`haze-${Date.now()}.${recorderRef.current?.extension ?? "webm"}`}>
                Download
              </a>
            </div>
          )}
        </aside>
      </div>

      <footer className="footer">
        <span>
          Everything runs on-device: MediaPipe face mesh → breath state machine → GPU particle sim. No tobacco, no
          nicotine, no upload.
        </span>
        <span>
          {live ? `${stats.particles.toLocaleString()} particles` : "camera idle"}
          {stats.quality < 1 && running ? ` · quality ${Math.round(stats.quality * 100)}%` : ""}
        </span>
      </footer>
    </div>
  );
}
