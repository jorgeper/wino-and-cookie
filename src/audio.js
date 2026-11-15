// Tiny synthesised sound effects (no audio files). Muted with M.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('wino-and-cookie-muted') === '1'; } catch { /* private window */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, { dur = 0.12, type = 'sine', gain = 0.12, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a || a.state !== 'running') return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  unlock: () => { ac(); },
  kick: () => tone(170, { dur: 0.12, type: 'triangle', gain: 0.2, slide: -90 }),
  bump: () => tone(120, { dur: 0.16, type: 'sine', gain: 0.22, slide: -60 }),
  boing: () => tone(300, { dur: 0.18, type: 'sine', gain: 0.14, slide: 260 }),
  pop: () => tone(520, { dur: 0.07, type: 'square', gain: 0.06, slide: -300 }),
  blip: () => tone(660, { dur: 0.08, type: 'sine', gain: 0.1 }),
  point: () => { tone(523, { dur: 0.14, gain: 0.12 }); tone(784, { dur: 0.2, gain: 0.12, delay: 0.1 }); },
  lose: () => { tone(392, { dur: 0.16, gain: 0.1 }); tone(294, { dur: 0.24, gain: 0.1, delay: 0.12 }); },
  cheer: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.22, gain: 0.11, delay: i * 0.09, type: 'triangle' })),
  whistle: () => tone(1500, { dur: 0.3, type: 'sine', gain: 0.06, slide: 200 }),
  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('wino-and-cookie-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    return muted;
  },
  get muted() { return muted; },
};
