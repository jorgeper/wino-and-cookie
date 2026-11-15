import * as THREE from 'three';

/** Steering input that walks/runs a character to a point and eases to a stop there. */
export function toward(c, tx, tz, { stop = 0.2, slow = 1.0, run = true } = {}) {
  const dx = tx - c.position.x, dz = tz - c.position.z, d = Math.hypot(dx, dz);
  if (d < stop) return null;
  const m = THREE.MathUtils.clamp(d / slow, 0.4, 1);
  return { x: (dx / d) * m, z: (dz / d) * m, run: run && d > slow * 0.6 };
}

export const clamp = THREE.MathUtils.clamp;
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const chip = (emoji, value, color) => `<span class="dot" style="background:${color}"></span>${emoji} <b>${value}</b>`;
