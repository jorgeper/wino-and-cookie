import { DEFAULTS } from './graphics.js';

// "Make it pretty": everything that improves the picture, at sensible strengths.
const BEST = { fabric: true, fuzz: true, sceneryDetail: true, grass: true, shadows: 'soft', ao: true, grade: true };

/** The settings gear: a panel that edits engine.graphics.settings live. */
export function initSettings(engine) {
  const { graphics } = engine;
  const panel = document.getElementById('settings');
  const gear = document.getElementById('gear');
  const inputs = [...panel.querySelectorAll('[data-gfx]')];
  const fmt = (v) => `${Number(v).toFixed(2)}×`;

  function paint() {
    const s = graphics.settings;
    for (const el of inputs) {
      const key = el.dataset.gfx;
      if (el.type === 'checkbox') el.checked = !!s[key];
      else if (document.activeElement !== el) el.value = s[key];
      const out = panel.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = fmt(el.type === 'range' ? el.value : s[key]);
      if (el.dataset.needs) {
        el.disabled = !s[el.dataset.needs];
        el.closest('.row').classList.toggle('off', el.disabled);
      }
    }
  }
  graphics.onChange(paint);
  paint();

  const read = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value);
  for (const el of inputs) {
    const key = el.dataset.gfx;
    // "lazy" sliders are costly to apply (replanting the grass): wait until the drag ends.
    const lazy = 'lazy' in el.dataset;
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        panel.querySelector(`[data-out="${key}"]`).textContent = fmt(el.value);
        if (!lazy) graphics.set({ [key]: read(el) });
      });
      el.addEventListener('change', () => { graphics.set({ [key]: read(el) }); el.blur(); });
    } else {
      // Give the keyboard back to the game afterwards (otherwise Space/arrows would poke the control).
      el.addEventListener('change', () => { graphics.set({ [key]: read(el) }); el.blur(); });
    }
  }

  const toggle = (open = panel.hidden) => {
    panel.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    gear.blur();
  };
  gear.onclick = () => toggle();
  document.getElementById('gfx-close').onclick = () => toggle(false);
  document.getElementById('gfx-reset').onclick = (e) => { graphics.set({ ...DEFAULTS }); e.currentTarget.blur(); };
  document.getElementById('gfx-best').onclick = (e) => { graphics.set({ ...BEST }); e.currentTarget.blur(); };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyG' && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLSelectElement)) toggle();
  });

  // Frame rate, always on screen, so the cost of each option is visible.
  const fpsEl = document.getElementById('fps');
  let frames = 0, since = performance.now();
  (function count() {
    requestAnimationFrame(count);
    frames++;
    const now = performance.now();
    if (now - since < 500) return;
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - since))} fps`;
    frames = 0; since = now;
  })();

  return { toggle, get open() { return !panel.hidden; } };
}
