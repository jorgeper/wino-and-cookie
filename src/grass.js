import * as THREE from 'three';
import { SHELL_LAYER } from './fabric.js';

/*
 * Procedural grass. Little tufts of three blades, drawn with instancing in chunks (so
 * off-screen chunks are skipped). The vertex shader does the moving parts:
 *   - wind: slow gusts that roll across the field plus a quick flutter per tuft
 *   - characters press the grass down and push it aside as they walk through
 * Blades are lit as if they pointed straight up, so the grass takes exactly the same light
 * and shadow as the ground it grows from.
 *
 * Grass is on the fur-shell layer: it is drawn in the main colour pass only, not in the
 * ambient-occlusion / depth-of-field helper passes.
 */

export const MAX_PUSHERS = 10;
export const grassUniforms = {
  uGrassTime: { value: 0 },
  uGrassWind: { value: 1 },
  uGrassHeight: { value: 1 },
  uGrassPushCount: { value: 0 },
  uGrassPush: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4()) }, // x, y, z, radius
};

const BASE_DENSITY = 40;   // tufts per square metre at density 1, close to the action
const CHUNK = 9;           // metres
const FULL_WITHIN = 10;    // chunks nearer the camera than this get the full clumps

function tuft(count) {
  const pos = [], t = [], idx = [];
  let n = 0;
  // A thick clump: tall blades in the middle, shorter ones leaning outwards around them, wide
  // enough that neighbouring tufts overlap and no bare ground shows through.
  // [offset x, offset z, turn, width, height, lean]
  const blades = [[0, 0, 0.3, 0.055, 1, 0.2]];
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2.399 + 0.5, r = 0.05 + 0.02 * (i % 3) + 0.012 * i; // golden-angle spiral
    blades.push([Math.cos(a) * r, Math.sin(a) * r, Math.PI / 2 - a + (i % 2 ? 0.5 : -0.4), 0.05 - 0.002 * i, 0.9 - 0.06 * i, 0.26 + 0.035 * i]);
  }
  for (const [ox, oz, yaw, w, h, lean] of blades) {
    const c = Math.cos(yaw), s = Math.sin(yaw), base = pos.length / 3;
    const tint = 0.86 + 0.28 * ((n++ * 0.618) % 1); // each blade a little lighter or darker than its neighbours
    const put = (x, y, u) => {
      const z = lean * y * y * h * 1.5; // arch forward towards the tip
      pos.push(ox + x * c + z * s, y * h * (1 - 0.12 * lean * y), oz - x * s + z * c);
      t.push(y, u, tint); // height along the blade, side of the blade (-1 left, 1 right), tint
    };
    put(-w / 2, 0, -1); put(w / 2, 0, 1); put(-w * 0.44, 0.4, -1); put(w * 0.44, 0.4, 1);
    put(-w * 0.3, 0.75, -1); put(w * 0.3, 0.75, 1); put(0, 1, 0);
    for (const k of [0, 2]) idx.push(base + k, base + k + 1, base + k + 2, base + k + 1, base + k + 3, base + k + 2);
    idx.push(base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const TUFT = tuft(6);
// Mown turf and far-away grass: the blades are too small on screen to need a full clump.
const TUFT_THIN = tuft(3);

const MATERIAL = (() => {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, grassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aT;
        varying vec3 vGrassT;
        varying float vGrassGust;
        uniform float uGrassTime, uGrassWind, uGrassHeight;
        uniform vec4 uGrassPush[${MAX_PUSHERS}];
        uniform int uGrassPushCount;`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(vec3(0.0, 1.0, 0.0) + objectNormal * 0.55); // mostly the ground\'s light, plus a little of the blade\'s own facing')
      .replace('#include <project_vertex>', /* glsl */ `
        vGrassT = aT;
        vec4 gw = modelMatrix * (instanceMatrix * vec4(transformed.x, transformed.y * uGrassHeight, transformed.z, 1.0));
        vec3 origin = (modelMatrix * instanceMatrix[3]).xyz;
        float tall = length(instanceMatrix[1].xyz) * uGrassHeight;

        // Wind: a wave of gusts travelling across the field, a slower cross-swell, and flutter.
        float gust = 0.5 + 0.5 * sin(dot(origin.xz, vec2(0.31, 0.19)) - uGrassTime * 1.5);
        gust *= gust;
        float swell = sin(dot(origin.xz, vec2(-0.17, 0.43)) * 1.3 - uGrassTime * 0.9);
        float flutter = sin(uGrassTime * 4.3 + origin.x * 3.1 + origin.z * 2.3);
        vec2 bend = (vec2(0.85, 0.52) * (0.08 + 0.36 * gust + 0.1 * swell) + vec2(-0.52, 0.85) * flutter * 0.05) * uGrassWind;
        vGrassGust = gust * min(uGrassWind, 1.5);

        // Characters push the grass away from their feet and flatten it.
        float squash = 0.0;
        for (int i = 0; i < ${MAX_PUSHERS}; i++) {
          if (i >= uGrassPushCount) break;
          vec4 pu = uGrassPush[i];
          vec2 d = origin.xz - pu.xz;
          float l = length(d);
          float f = (1.0 - smoothstep(pu.w * 0.35, pu.w, l)) * (1.0 - smoothstep(0.15, 0.7, pu.y - origin.y));
          bend += (d / (l + 1e-3)) * f * 0.7;
          squash = max(squash, f);
        }
        float k = aT.x * aT.x;
        gw.xz += bend * tall * k;
        gw.y -= (length(bend) * 0.3 + squash * 0.5) * tall * k;

        vec4 mvPosition = viewMatrix * gw;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassT;\nvarying float vGrassGust;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // darker at the roots, lighter at the tips; gusts brush a pale sheen across the field
        // Each blade is shaded as if folded down its middle: one half catches the light, the other
        // sits in its own shade. That, the dark roots and the per-blade tint give the clump depth.
        float fold = mix(0.8, 1.1, smoothstep(-0.2, 0.2, vGrassT.y));
        float rib = 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.14, abs(vGrassT.y)));
        diffuseColor.rgb *= mix(0.42, 1.06, sqrt(vGrassT.x)) * fold * rib * vGrassT.z * (1.0 + 0.14 * vGrassGust * vGrassT.x);`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => 'grass-v2';
  return m;
})();

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D noise in 0..1, for patchy growth and colour drift. */
function valueNoise(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z);
  let fx = x - xi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const LUSH = [0x6fb556, 0x7abd5e, 0x86c466, 0x90cb6c];
const DRY = [0x90cb6c, 0x9bd070, 0xa5d274, 0x86c466];

/**
 * Grass for a forest clearing: knee-high under the trees, shorter out in the open, patchy.
 * @param clearing radius of the open middle
 * @param surface  optional (x, z) => 'bare' for no grass (sand, straw, a stump), or
 *                 { h, color } for mown turf of that blade height and colour, or nothing for meadow
 */
export function createGrass({ seed = 1, clearing = 18, surface }) {
  const radius = clearing + 26;
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sample = (x, z) => {
    const s = surface?.(x, z);
    if (s === 'bare') return null;
    if (s) return { density: 1, wide: 0.8, thin: s.h < 0.12, ...s };
    const r = Math.hypot(x, z);
    const edge = smooth(clearing - 7, clearing + 2, r);   // 0 in the open, 1 under the trees
    const far = smooth(clearing + 6, radius, r);          // thins out and fades into the distance
    const patch = valueNoise(x * 0.33 + seed, z * 0.33 - seed);
    return {
      h: (0.13 + 0.3 * edge) * (0.7 + 0.6 * patch) * (1 - 0.6 * far * far),
      density: (0.8 + 0.2 * patch) * (1 - 0.8 * far),
      wide: 1 + 0.9 * far,
      thin: far > 0.25,
    };
  };
  const group = new THREE.Group();
  group.name = 'grass';
  group.userData = { seed, radius, sample, built: null };
  return group;
}

function clear(group) {
  for (const m of [...group.children]) { group.remove(m); m.dispose(); }
}

function build(group, density) {
  const { seed, radius, sample } = group.userData;
  clear(group);
  const rng = mulberry32(seed * 7919 + 13);
  const full = BASE_DENSITY * density;
  const step = 1 / Math.sqrt(full);
  const n = Math.ceil(radius / step);
  const chunks = new Map();
  const col = new THREE.Color();
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = (i + rng()) * step, z = (j + rng()) * step, r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
      if (x * x + z * z > radius * radius) continue;
      const s = sample(x, z);
      if (!s || s.h <= 0 || r1 > (s.density ?? 1)) continue;
      let hex;
      if (s.color != null) hex = s.color;
      else {
        const dry = valueNoise(x * 0.11 + 40, z * 0.11 - 9);
        hex = (r2 < dry * dry ? DRY : LUSH)[Math.floor(r3 * 4)];
      }
      col.set(hex);
      if (s.color != null) col.multiplyScalar(0.94 + r3 * 0.16);
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)},${s.thin ? 't' : 'f'}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      list.push(x, z, r4 * Math.PI * 2, s.h * (0.7 + r2 * 0.6), (s.wide ?? 1) * (0.85 + r3 * 0.4), col.r, col.g, col.b);
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of chunks) {
    const count = list.length / 8;
    const mesh = new THREE.InstancedMesh(key.endsWith('t') ? TUFT_THIN : TUFT, MATERIAL, count);
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      p.set(list[o], 0, list[o + 1]);
      q.setFromAxisAngle(up, list[o + 2]);
      sc.set(list[o + 4], list[o + 3], list[o + 4]);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      mesh.setColorAt(i, col.setRGB(list[o + 5], list[o + 6], list[o + 7]));
    }
    mesh.userData.lod = !key.endsWith('t'); // full clumps up close, light ones further off
    mesh.receiveShadow = true;
    mesh.layers.set(SHELL_LAYER);
    mesh.renderOrder = 1; // after the scenery, so anything in front of the grass hides it before it is shaded
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 1; // room for wind sway
    group.add(mesh);
  }
  group.userData.built = density;
}

/** Show / hide the grass and (re)grow it when the density changes. */
export function applyGrassSettings(group, s) {
  if (!group) return;
  group.visible = !!s.grass;
  if (s.grass && group.userData.built !== s.grassDensity) build(group, s.grassDensity);
}

const lodPoint = new THREE.Vector3();
/** Every frame: full clumps near the camera, three-blade tufts where the difference can't be seen. */
export function updateGrassDetail(group, camera) {
  if (!group?.visible) return;
  group.worldToLocal(lodPoint.copy(camera.position));
  for (const m of group.children) {
    if (!m.userData.lod) continue;
    const near = lodPoint.distanceTo(m.boundingSphere.center) - m.boundingSphere.radius < FULL_WITHIN;
    const geo = near ? TUFT : TUFT_THIN;
    if (m.geometry !== geo) m.geometry = geo;
  }
}

/** How many tufts are planted (for the console / debugging). */
export const grassCount = (group) => group.children.reduce((n, m) => n + m.count, 0);

/** 1 while grass is switched on: the ground under it then looks like a thatch of blades. */
export const groundUniforms = { uGroundGrass: { value: 1 }, uGroundSnow: { value: 0 } };

/**
 * Paint the ground itself like matted grass (short streaks in a few directions, darker than
 * the blade tips), so whatever shows between the tufts still reads as lawn, not bare colour.
 */
export function applyGroundShader(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vGroundPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
        #else
          vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec2 vGroundPos;
        uniform float uGroundGrass, uGroundSnow;
        float gndHash(vec2 p) { // cheap hash without trigonometry
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float gndNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gndHash(i), gndHash(i + vec2(1, 0)), f.x), mix(gndHash(i + vec2(0, 1)), gndHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        if (uGroundGrass > 0.0) {
          vec2 p = vGroundPos;
          float fade = 1.0 - smoothstep(0.3, 1.0, length(fwidth(p)) * 75.0); // no shimmer far away
          float tone = 0.82;
          if (fade > 0.0) { // only where the streaks are big enough to see
            float streaks = gndNoise(vec2((0.88 * p.x - 0.48 * p.y) * 75.0, (0.48 * p.x + 0.88 * p.y) * 8.0))
              + gndNoise(vec2((-0.36 * p.x - 0.93 * p.y) * 75.0 + 7.3, (0.93 * p.x - 0.36 * p.y) * 8.0))
              + gndNoise(vec2((-0.97 * p.x + 0.26 * p.y) * 60.0 + 14.6, (-0.26 * p.x - 0.97 * p.y) * 9.0));
            float streaky = mix(0.6, 1.0, smoothstep(0.3, 0.72, streaks / 3.0)) * (0.92 + 0.16 * gndNoise(p * 1.7));
            tone = mix(tone, streaky, fade);
          }
          diffuseColor.rgb *= mix(1.0, tone, uGroundGrass * (1.0 - uGroundSnow));
        }
        if (uGroundSnow > 0.0) {
          // Fresh snow: soft drifts of blue shade and a fine sparkle up close.
          vec2 p = vGroundPos;
          float drift = gndNoise(p * 0.45) * 0.6 + gndNoise(p * 1.9) * 0.4;
          float grain = gndNoise(p * 90.0) * (1.0 - smoothstep(0.3, 1.0, length(fwidth(p)) * 90.0));
          vec3 snow = mix(vec3(0.80, 0.87, 0.97), vec3(0.97, 0.98, 1.0), drift) * (0.97 + 0.06 * grain);
          diffuseColor.rgb = mix(diffuseColor.rgb, snow, uGroundSnow);
        }`);
  };
  material.customProgramCacheKey = () => 'grass-ground-v3';
  return material;
}
