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

/** A row of little dots for showing where a throw will go. `show(points)` takes [x, y, z] triples; the rest hide. */
export function makeDots(count, color = 0xffffff, size = 0.07) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.userData.own = true;
    m.scale.setScalar(size * (1 - (i / count) * 0.55));
    m.visible = false;
    group.add(m);
  }
  group.show = (points) => group.children.forEach((m, i) => {
    m.visible = i < points.length;
    if (m.visible) m.position.fromArray(points[i]);
  });
  return group;
}

/**
 * Soft glowing dots (fireflies, stars, snowflakes). Per-point `aSize` is in metres and `color` tints.
 * Drawn only in the colour pass, like the fur and the grass.
 */
export function glowPoints(count, { additive = true, fog = false } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count).fill(0.2), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1000 }, uFogColor: { value: new THREE.Color() }, uFog: { value: new THREE.Vector2(1e5, 1e6) } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 color; uniform float uScale; varying vec3 vC; varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vC = color; vDepth = -mv.z;
        gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor; uniform vec2 uFog; varying vec3 vC; varying float vDepth;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        float f = 1.0 - smoothstep(uFog.x, uFog.y, vDepth);
        ${additive
          ? 'gl_FragColor = vec4(vC * (a * a * 0.9 + smoothstep(0.35, 0.0, d) * 1.6) * f, 1.0);'
          : 'gl_FragColor = vec4(mix(uFogColor, vC, f), smoothstep(1.0, 0.45, d) * 0.92);'}
      }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.layers.set(1); // SHELL_LAYER
  points.userData.fogged = fog;
  /** Call every frame: keeps sizes right for the window and (optionally) fades into the fog. */
  points.sync = (ctx) => {
    mat.uniforms.uScale.value = ctx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2)));
    if (fog) { mat.uniforms.uFogColor.value.copy(ctx.scene.fog.color); mat.uniforms.uFog.value.set(ctx.scene.fog.near, ctx.scene.fog.far); }
  };
  points.dispose = () => { geo.dispose(); mat.dispose(); };
  return points;
}
