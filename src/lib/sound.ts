export type SoundRole =
  | "interaction.tap" | "interaction.subtle" | "interaction.toggle" | "interaction.confirm"
  | "overlay.open" | "overlay.close" | "overlay.expand" | "overlay.collapse"
  | "navigation.forward" | "navigation.backward" | "navigation.tab"
  | "notification.info" | "notification.success" | "notification.warning" | "notification.error"
  | "hero.complete" | "hero.milestone"
  | "media.volume" | "media.play" | "media.stop";

const SOUNDS: Record<string, (c: AudioContext, t: number, v: number) => void> = {
  "interaction.tap": chipClick(3800, 0.008, 1.0),
  "interaction.subtle": chipClick(3600, 0.008, 0.8),
  "interaction.toggle": chipToggle(700, 480, 0.035, 0.64),
  "interaction.confirm": chipClick(5500, 0.012, 0.8),
  "navigation.forward": chipSweep(280, 440, 0.16, 0.5),
  "navigation.backward": chipSweep(440, 280, 0.16, 0.5),
  "navigation.tab": chipPop(680, 880, 0.04, 0.35),
  "notification.info": chipTone(587.33, 0.22, 0.45),
  "notification.success": chipArp([523.25, 659.25], 0.1, 0.12, 0.55),
  "notification.warning": chipArp([440, 440], 0.08, 0.1, 0.6),
  "notification.error": chipArp([493.88, 349.23], 0.1, 0.12, 0.62),
  "overlay.open": chipSweep(320, 480, 0.2, 0.5),
  "overlay.close": chipSweep(480, 320, 0.2, 0.5),
  "overlay.expand": chipSweep(380, 500, 0.13, 0.45),
  "overlay.collapse": chipSweep(500, 380, 0.13, 0.45),
  "hero.complete": chipTone(523.25, 0.5, 0.6),
  "hero.milestone": chipTone(392, 0.4, 0.5),
  "media.volume": chipPop(400, 600, 0.04, 0.25),
  "media.play": chipClick(2800, 0.015, 0.6),
  "media.stop": chipSweep(400, 200, 0.12, 0.4),
};

function chipClick(freq: number, dur: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.03));
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol * v;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  };
}

function chipPop(freq: number, endFreq: number, dur: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    const osc = c.createOscillator(); osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * 1.1, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq * 1.1, t + dur * 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  };
}

function chipToggle(freq: number, endFreq: number, dur: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    const len = Math.floor(c.sampleRate * 0.008);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.04));
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 8;
    const ng = c.createGain(); ng.gain.value = vol * v * 0.2;
    src.connect(f).connect(ng).connect(c.destination);
    src.start(t);
    const osc = c.createOscillator(); osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * 1.1, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq * 1.1, t + 0.03);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * v * 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.01);
  };
}

function chipSweep(startFreq: number, endFreq: number, dur: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    const osc = c.createOscillator(); osc.type = "triangle";
    osc.frequency.setValueAtTime(startFreq * 1.1, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq * 1.1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.04);
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  };
}

function chipTone(freq: number, dur: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    const osc = c.createOscillator(); osc.type = "triangle";
    osc.frequency.value = freq * 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  };
}

function chipArp(notes: number[], noteDur: number, gap: number, vol: number) {
  return (c: AudioContext, t: number, v: number) => {
    notes.forEach((freq, i) => {
      const nt = t + i * (noteDur + gap);
      const osc = c.createOscillator(); osc.type = "triangle";
      osc.frequency.value = freq * 1.1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, nt); g.gain.linearRampToValueAtTime(vol * v, nt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, nt + noteDur + (i === notes.length - 1 ? 0.4 : 0.06));
      osc.connect(g).connect(c.destination);
      osc.start(nt); osc.stop(nt + noteDur + 0.45);
    });
  };
}

let ctx: AudioContext | null = null;
let vol = 0.5;
let muted = false;

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  return ctx;
}

export function isMuted() { return muted; }
export function toggleMuted() { muted = !muted; return muted; }

export function play(role: SoundRole) {
  if (muted) return;
  const fn = SOUNDS[role];
  if (!fn) return;
  const c = getCtx();
  if (c.state !== "running") c.resume();
  fn(c, c.currentTime, vol);
}

