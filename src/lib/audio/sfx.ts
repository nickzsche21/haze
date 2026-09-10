/**
 * Synthesised sound. No audio files ship with the app — every sound here is a
 * few oscillators and a noise buffer, which keeps the payload at zero and lets
 * exhales scale their timbre with how hard you actually blew.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private crackleUntil = 0;
  muted = false;

  /** Must be called from a user gesture. */
  async enable() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  private src() {
    if (!this.ctx || !this.noise || this.muted) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  /** A breathy sweep whose brightness and length track the exhale's strength. */
  exhale(strength: number, kind: "mouth" | "nose" | "ring") {
    const ctx = this.ctx;
    const src = this.src();
    if (!ctx || !src || !this.master) return;
    const s = Math.max(0.12, Math.min(1, strength));
    const dur = kind === "ring" ? 0.34 : 0.42 + s * 0.85;
    const t = ctx.currentTime;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = kind === "nose" ? 2.4 : 0.9;
    const top = kind === "nose" ? 1500 : 900 + s * 1400;
    filter.frequency.setValueAtTime(top, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, top * 0.28), t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05 + 0.3 * s, t + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);

    if (kind === "ring") {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.3);
      og.gain.setValueAtTime(0.14, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(og).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  /** Paper burning: sparse clicks, rate-limited so a long drag doesn't buzz. */
  crackle(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    if (ctx.currentTime < this.crackleUntil) return;
    if (Math.random() > intensity * 0.5) return;
    this.crackleUntil = ctx.currentTime + 0.035 + Math.random() * 0.09;

    const src = this.src();
    if (!src) return;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05 * intensity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.06);
  }

  /** Two notes up, brighter with the combo. */
  trick(combo: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    const t = ctx.currentTime;
    const root = 420 * Math.pow(1.0595, Math.min(combo, 5) * 3);
    [0, 0.09].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = root * (i === 0 ? 1 : 1.5);
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.12, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.3);
      osc.connect(g).connect(master);
      osc.start(t + delay);
      osc.stop(t + delay + 0.32);
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
