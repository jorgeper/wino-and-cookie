import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applySceneryShader } from './scenery-shader.js';
import { createGrass, applyGroundShader } from './grass.js';

/*
 * Forest kit shared by every game. Trees, bushes, rocks, stumps, mushrooms and flowers
 * are the models in `assets/`; ground patches and clouds are simple shapes.
 * Scattered things are drawn with instancing, so a whole forest is a handful of draw calls.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEO = {
  blob: new THREE.IcosahedronGeometry(1, 0),
  blob1: new THREE.IcosahedronGeometry(1, 1),
  disc: new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2),
  log: new THREE.CylinderGeometry(1, 1, 1, 8),
};
const flat = (opts = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true, ...opts });
const MAT = { solid: flat(), ground: applyGroundShader(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })) };

/*
 * Scenery models. Every `assets/<name>/<name>.glb` is picked up here, so dropping a new
 * model into its folder is enough to make it available as MODELS['<name>'].
 * Each one is re-based to stand on y = 0, centred, and exactly 1 unit tall, so an
 * instance's scale is its height in metres.
 */
const MODEL_URLS = import.meta.glob('../assets/*/*.glb', { query: '?url', import: 'default', eager: true });
const MODELS = {};

export async function loadScenery() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MODEL_URLS).map(async ([path, url]) => {
    const name = path.split('/').at(-2);
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    const bb = geo.boundingBox, h = bb.max.y - bb.min.y || 1;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2).scale(1 / h, 1 / h, 1 / h);
    // Matte painted look; the exported material carries glass settings we don't want.
    const mat = new THREE.MeshStandardMaterial({ map: mesh.material.map, roughness: 0.92, metalness: 0 });
    if (mat.map) mat.map.anisotropy = 8;
    applySceneryShader(mat, name); // leaf / bark / stone detail, off unless switched on in the settings
    // `radius`: half the model's width, for a model 1 unit tall (used to keep the view clear).
    MODELS[name] = { geo, mat, radius: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2 / h };
  }));
}

/** How wide a scenery model is when it is 1 unit tall, or 0 if it isn't loaded. */
export const modelWidth = (name) => (MODELS[name] ? MODELS[name].radius * 2 : 0);

export const PALETTE = {
  grass: 0x8cc76a, grassDark: 0x79b85c, grassLight: 0xa5d67c,
  pine: [0x3f8f5a, 0x4a9d62, 0x357f55, 0x5aa86a],
  leaf: [0x6fb85a, 0x86c764, 0x5aa552, 0xa4cf68, 0xe0a650, 0xdd8a52],
  trunk: 0x8a6244, wood: 0xa97c54, woodDark: 0x7d5a3e, woodLight: 0xd9b88c,
  rock: [0xa9adb3, 0x9aa0a8, 0xb9bcc0],
  mushroom: [0xe2574c, 0xf0a24a, 0xe77fa0],
  flower: [0xffffff, 0xffd84d, 0xff9ebd, 0xb79bff, 0xff7b6b],
  cream: 0xfff3dc,
};

/** Collects instances, then builds one InstancedMesh per (geometry, shadow) pair. */
export class Scatter {
  constructor() { this.buckets = new Map(); }

  add(geoName, pos, scale, color, { rotY = 0, rotX = 0, rotZ = 0, shadow = true, mat = 'solid' } = {}) {
    const key = `${geoName}|${shadow}|${mat}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { geoName, shadow, mat, items: [] }));
    b.items.push({ pos, scale, color, rotX, rotY, rotZ });
  }

  build() {
    const group = new THREE.Group();
    group.userData.blockers = []; // model instances that could stand in the camera's way (see clearView)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    for (const b of this.buckets.values()) {
      const model = MODELS[b.geoName];
      const mesh = new THREE.InstancedMesh(model ? model.geo : GEO[b.geoName], model ? model.mat : MAT[b.mat], b.items.length);
      b.items.forEach((it, i) => {
        p.set(...it.pos);
        if (Array.isArray(it.scale)) s.set(...it.scale); else s.setScalar(it.scale);
        q.setFromEuler(e.set(it.rotX, it.rotY, it.rotZ));
        mesh.setMatrixAt(i, m.compose(p, q, s));
        mesh.setColorAt(i, c.set(it.color));
      });
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      if (model && !Array.isArray(b.items[0]?.scale)) {
        group.userData.blockers.push({ mesh, items: b.items.map((it, i) => {
          const base = new THREE.Matrix4();
          mesh.getMatrixAt(i, base);
          return { x: it.pos[0], z: it.pos[2], h: it.scale, r: it.scale * model.radius * 0.85, base, k: 1 };
        }) });
      }
    }
    return group;
  }
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Slight light/dark and warm/cool variation so copies of one model don't look identical. */
const shade = (rng) => new THREE.Color().setHSL(0.1 + rng() * 0.2, 0.25, 0.86 + rng() * 0.14);

/** Place one model, `height` metres tall, with a random turn. Does nothing if the model is missing. */
export function addModel(sc, rng, name, x, z, height, opts = {}) {
  if (!MODELS[name]) return false;
  sc.add(name, [x, 0, z], height, shade(rng), { rotY: rng() * Math.PI * 2, ...opts });
  return true;
}

const TREES = [['pine-tree', 3.6, 1.8], ['birch-tree', 3.4, 1.2], ['maple-tree', 3.1, 1.2], ['pine-tree', 3.6, 1.8], ['birch-tree', 3.4, 1.2]];
export function addTree(sc, rng, x, z, s = 1) {
  const [name, base, extra] = pick(rng, TREES.filter(([n]) => MODELS[n]));
  addModel(sc, rng, name, x, z, (base + rng() * extra) * s);
}

export const addBush = (sc, rng, x, z, s = 1) => addModel(sc, rng, 'rounded-bush', x, z, (0.45 + rng() * 0.3) * s);
export const addStump = (sc, rng, x, z, s = 1) => addModel(sc, rng, 'tree-stump', x, z, (0.5 + rng() * 0.3) * s);
export const addMushroom = (sc, rng, x, z, s = 1) => addModel(sc, rng, 'mushroom-cluster', x, z, (0.4 + rng() * 0.3) * s);
export const addFlower = (sc, rng, x, z) => addModel(sc, rng, 'wildflower-clump', x, z, 0.28 + rng() * 0.16, { shadow: false });
export const addRock = (sc, rng, x, z, s = 1) => addModel(sc, rng, 'rock', x, z, (0.22 + rng() * 0.38) * s);
export const addBoulder = (sc, rng, x, z, s = 1) =>
  addModel(sc, rng, 'mossy-boulder', x, z, (0.7 + rng() * 0.5) * s) || addModel(sc, rng, 'rock', x, z, (0.5 + rng() * 0.3) * s);

/**
 * A little still life at the foot of a tree (or on its own): rocks of mixed sizes, and
 * now and then a flower clump or some mushrooms tucked in beside them.
 * @param inner how far from the centre things start (clears the trunk)
 */
export function addCluster(sc, rng, x, z, { inner = 0.9, ok = () => true } = {}) {
  const near = (from, to) => {
    const a = rng() * Math.PI * 2, r = from + rng() * (to - from);
    return [x + Math.cos(a) * r, z + Math.sin(a) * r];
  };
  const side = rng() * Math.PI * 2;                 // rocks gather on one side
  const rocks = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < rocks; i++) {
    const a = side + (rng() - 0.5) * 2.2, r = inner + rng() * 1.1;
    const rx = x + Math.cos(a) * r, rz = z + Math.sin(a) * r;
    if (!ok(rx, rz)) continue;
    if (i === 0 && rng() < 0.6) addBoulder(sc, rng, rx, rz); else addRock(sc, rng, rx, rz, i === 1 ? 1.3 : 0.8);
  }
  if (rng() < 0.55) { const [fx, fz] = near(inner, inner + 1.3); if (ok(fx, fz)) addFlower(sc, rng, fx, fz); }
  if (rng() < 0.3) { const [mx, mz] = near(inner * 0.8, inner + 0.8); if (ok(mx, mz)) addMushroom(sc, rng, mx, mz); }
}

/** Soft darker / lighter patches so the grass isn't one flat colour. */
export function addGroundPatch(sc, rng, x, z, r) {
  sc.add('disc', [x, 0.012 + rng() * 0.01, z], [r, 1, r * (0.6 + rng() * 0.5)], rng() < 0.5 ? PALETTE.grassDark : PALETTE.grassLight,
    { shadow: false, rotY: rng() * 6, mat: 'ground' });
}

/** Outline (convex hull) of everywhere `inside(x, z)` is true, sampled every metre. Null if there is nowhere. */
function outlineOf(inside, reach) {
  const pts = [];
  for (let x = -reach; x <= reach; x++) for (let z = -reach; z <= reach; z++) if (inside(x, z)) pts.push([x, z]);
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) { while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop(); out.push(p); }
    return out.slice(0, -1);
  };
  const hull = [...half(pts), ...half(pts.reverse())];
  return hull.length >= 3 ? hull : null;
}

/** How far along a ray (from cx, cz in unit direction dx, dz) it first crosses the outline; Infinity if it never does. */
function reachOutline(hull, cx, cz, dx, dz) {
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - cx) * ez - (a[1] - cz) * ex) / den, u = ((a[0] - cx) * dz - (a[1] - cz) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

const POKE = 1.0; // a bush or boulder may rise this far (metres) into the line of sight before it is put away
const TREE = 2.0; // anything taller than this counts as a tree

/**
 * Keeps the camera's view of the play area clear. Anything tall enough to cover part of the
 * play area from where the camera is, and any tree standing between the camera and the play
 * area, shrinks away, and grows back when the camera moves on. Things beside or behind the play area stay.
 * @param blockers from Scatter.build()
 * @param hull outline of the play area
 * @param dt seconds since the last call; Infinity to switch at once (a new game, a camera cut)
 */
function clearView(blockers, hull, camera, dt) {
  const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
  // A camera over the play area itself has nothing between it and the game.
  let sign = 0, over = true;
  for (let i = 0; i < hull.length && over; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const side = Math.sign((b[0] - a[0]) * (cz - a[1]) - (b[1] - a[1]) * (cx - a[0]));
    if (side && sign && side !== sign) over = false;
    if (side) sign = side;
  }
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), step = dt * 5;
  for (const { mesh, items } of blockers) {
    let dirty = false;
    items.forEach((it, i) => {
      let hide = false;
      if (!over && it.h > POKE) {
        const ox = it.x - cx, oz = it.z - cz, d = Math.hypot(ox, oz) || 1e-6;
        // Its middle and both edges, as seen from above.
        for (let side = -1; side <= 1 && !hide; side++) {
          const px = ox - (oz / d) * it.r * side, pz = oz + (ox / d) * it.r * side, dist = Math.hypot(px, pz) || 1e-6;
          const edge = reachOutline(hull, cx, cz, px / dist, pz / dist);
          if (edge === Infinity || dist >= edge) continue; // not between the camera and the play area
          // A tree in that stretch always goes: even one too low to cover the play area stands in
          // the foreground, where it fills the bottom of a tall (phone) screen. Smaller things go
          // only if they rise into the lowest line of sight over this spot, which is the one to the
          // nearest edge of the play area.
          // (A tree counts as in that stretch by its trunk; one whose branches merely reach the
          // edge of it is beside the play area, and stays to frame the picture.)
          if ((it.h > TREE && side === 0) || it.h > cy * (1 - dist / edge) + POKE) hide = true;
        }
      }
      const goal = hide ? 0 : 1;
      if (it.k === goal) return;
      it.k += Math.max(-step, Math.min(step, goal - it.k));
      mesh.setMatrixAt(i, m.copy(it.base).scale(v.setScalar(Math.max(it.k, 1e-4))));
      dirty = true;
    });
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * A clearing in the woods: grass, a ring of trees, and small decorations.
 * @param keepOut (x, z) => true where nothing may be placed (the play area)
 * @param view (x, z) => true for the ground the camera must always see; the play area unless given
 * @param surface (x, z) => 'bare' | { h, color } | undefined: what grows there (see grass.js)
 */
export function buildForest({ seed = 1, clearing = 18, keepOut = () => false, solidOut = keepOut, view = keepOut, trees = 90, deco = 1, surface } = {}) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 48).rotateX(-Math.PI / 2),
    applyGroundShader(new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 })));
  ground.receiveShadow = true;
  group.add(ground);

  const sc = new Scatter();
  const open = (x, z) => !solidOut(x, z);          // things you'd expect to bump into
  const ring = (inner, outer) => {
    const a = rng() * Math.PI * 2, r = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };

  for (let i = 0; i < trees; i++) {
    const far = i > trees * 0.45;
    const [x, z] = far ? ring(clearing + 6, clearing + 34) : ring(clearing, clearing + 8);
    if (!open(x, z)) continue;
    const s = 0.85 + rng() * 0.6 + (far ? 0.25 : 0);
    addTree(sc, rng, x, z, s);
    if (rng() < (far ? 0.12 : 0.4) * deco) addCluster(sc, rng, x, z, { inner: 0.9 * s, ok: open });
  }
  // A few rock piles out in the open, away from any tree.
  for (let i = 0; i < 3 * deco; i++) { const [x, z] = ring(clearing - 4, clearing + 3); if (open(x, z)) addCluster(sc, rng, x, z, { inner: 0.1, ok: open }); }
  for (let i = 0; i < 26 * deco; i++) { const [x, z] = ring(clearing - 5, clearing + 6); if (open(x, z)) addBush(sc, rng, x, z, 0.8 + rng() * 0.7); }
  for (let i = 0; i < 7 * deco; i++) { const [x, z] = ring(clearing - 4, clearing + 6); if (open(x, z)) addStump(sc, rng, x, z); }
  for (let i = 0; i < 46; i++) { const [x, z] = ring(0, clearing + 20); addGroundPatch(sc, rng, x, z, 1.2 + rng() * 3); }
  const scattered = sc.build();
  group.add(scattered);
  const hull = outlineOf(view, clearing + 34);
  /** Called by the engine every frame, after the camera has moved. */
  group.userData.clearView = (camera, dt) => { if (hull) clearView(scattered.userData.blockers, hull, camera, dt); };
  group.add(createGrass({ seed, clearing, surface })); // planted by the engine, from the settings

  // A few puffy clouds, far away.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = 70 + rng() * 50, y = 26 + rng() * 16;
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(GEO.blob1, cloudMat);
      const s = 3 + rng() * 3.5;
      puff.scale.set(s * 1.5, s * 0.7, s);
      puff.position.set(Math.cos(a) * r + (j - 1.5) * 4.2, y + rng() * 1.5, Math.sin(a) * r + rng() * 3);
      clouds.add(puff);
    }
  }
  group.add(clouds);
  group.userData.clouds = clouds;
  return group;
}

/** A single log lying between two points (fences, goals, borders). */
export function makeLog(a, b, radius = 0.12, color = PALETTE.wood) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const mesh = new THREE.Mesh(GEO.log, applySceneryShader(flat({ color }), 'log', [radius, len, radius]));
  mesh.scale.set(radius, len, radius);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Soft fabric-looking material for toys (balls, cushions, balloons). */
export function plushMaterial(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.9, metalness: 0, sheen: 0.7, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.6), ...opts,
  });
}

export function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Flat decal on the ground (pitch, court, ring markings). */
export function groundDecal(width, depth, tex, y = 0.02) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/** Ring that sits under the character you control. */
export function makeMarker(color = 0xffffff) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  mesh.position.y = 0.04;
  mesh.renderOrder = 2;
  return mesh;
}

/** Dark blob under a flying ball so its position over the ground is readable. */
export function makeBlobShadow(radius) {
  const tex = canvasTexture(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, 'rgba(20,30,20,0.55)');
    grd.addColorStop(1, 'rgba(20,30,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  mesh.position.y = 0.035;
  mesh.renderOrder = 1;
  return mesh;
}
