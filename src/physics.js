import * as THREE from 'three';

/** Push overlapping characters apart (circles on the ground). Calls onContact(a, b, nx, nz) per touching pair. */
export function separateCharacters(chars, onContact) {
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i], b = chars[j];
      if (Math.abs(a.position.y - b.position.y) > Math.max(a.height, b.height)) continue;
      let dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const min = a.radius + b.radius;
      let d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const nx = dx / d, nz = dz / d, push = (min - d) / 2;
      a.position.x -= nx * push; a.position.z -= nz * push;
      b.position.x += nx * push; b.position.z += nz * push;
      onContact?.(a, b, nx, nz);
    }
  }
}

/** Keep a circle (position, radius) out of wall segments [{ax, az, bx, bz}]. */
export function collideSegments(pos, radius, segments) {
  for (const s of segments) {
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const t = THREE.MathUtils.clamp(((pos.x - s.ax) * ex + (pos.z - s.az) * ez) / (ex * ex + ez * ez), 0, 1);
    const cx = s.ax + ex * t, cz = s.az + ez * t;
    let dx = pos.x - cx, dz = pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d < 1e-4) { dx = -ez; dz = ex; const l = Math.hypot(dx, dz); dx /= l; dz /= l; } else { dx /= d; dz /= d; }
    pos.x = cx + dx * radius;
    pos.z = cz + dz * radius;
  }
}

/** A bouncing sphere. The game decides what happens at walls and on contact with characters. */
export class Ball {
  constructor({ radius, gravity = 18, bounce = 0.55, airDrag = 0.15, groundDrag = 0.9, mesh }) {
    Object.assign(this, { radius, gravity, bounce, airDrag, groundDrag, mesh });
    this.pos = mesh.position;
    this.vel = new THREE.Vector3();
    this.bounced = 0; // impact speed of a ground bounce this step (for sounds)
    this._axis = new THREE.Vector3();
  }

  step(dt) {
    const { pos, vel, radius } = this;
    this.bounced = 0;
    vel.y -= this.gravity * dt;
    const onGround = pos.y <= radius + 0.01 && Math.abs(vel.y) < 1;
    const drag = Math.exp(-(onGround ? this.groundDrag : this.airDrag) * dt);
    vel.x *= drag; vel.z *= drag;
    if (!onGround) vel.y *= Math.exp(-this.airDrag * dt);
    pos.addScaledVector(vel, dt);
    if (pos.y < radius) {
      pos.y = radius;
      if (vel.y < 0) {
        this.bounced = -vel.y;
        vel.y = -vel.y * this.bounce;
        if (vel.y < 0.8) vel.y = 0;
      }
    }
    // Roll: spin about the horizontal axis perpendicular to travel.
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 0.01) {
      this._axis.set(vel.z / sp, 0, -vel.x / sp);
      this.mesh.rotateOnWorldAxis(this._axis, (sp * dt) / radius);
    }
  }
}

/**
 * Sphere vs a character's body (upright capsule). Moves the ball out of the body and
 * returns the contact normal (pointing from the character to the ball), or null.
 */
const _n = new THREE.Vector3();
export function ballVsCharacter(ball, c) {
  const r = c.radius;
  const y0 = c.position.y + r, y1 = c.position.y + Math.max(c.height - r, r);
  const cy = THREE.MathUtils.clamp(ball.pos.y, y0, y1);
  _n.set(ball.pos.x - c.position.x, ball.pos.y - cy, ball.pos.z - c.position.z);
  const d = _n.length(), min = r + ball.radius;
  if (d >= min) return null;
  if (d < 1e-4) _n.set(0, 1, 0); else _n.multiplyScalar(1 / d);
  ball.pos.addScaledVector(_n, min - d);
  return _n;
}
