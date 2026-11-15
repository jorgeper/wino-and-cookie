import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character } from './character.js';
import { FabricFX } from './fabric.js';
import { sfx } from './audio.js';
import { loadScenery } from './forest.js';

// Sky / light moods. Games pick one, or blend between two (the herding game's sunset).
export const MOODS = {
  day: { top: 0x7cc4f5, horizon: 0xe6f6ff, sun: 0xfff1d6, sunI: 3.0, hemiSky: 0xe4f2ff, hemiGround: 0x86b56c, hemiI: 1.05, env: 0.35, sunDir: [6, 14, 7] },
  golden: { top: 0x9cc3e8, horizon: 0xffe6c2, sun: 0xffd09a, sunI: 3.1, hemiSky: 0xffeedd, hemiGround: 0x8fae68, hemiI: 0.9, env: 0.3, sunDir: [10, 9, 6] },
  dusk: { top: 0x4a5596, horizon: 0xf8b189, sun: 0xffa56e, sunI: 2.3, hemiSky: 0xb3b2e6, hemiGround: 0x7a8f66, hemiI: 0.9, env: 0.26, sunDir: [12, 5, 4] },
};

const $ = (id) => document.getElementById(id);

export async function createEngine() {
  const app = $('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 40, 150);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // soft reflections for the plush sheen

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400);
  camera.layers.enable(1); // fur-shell layer from fabric.js (unused unless shells are switched on)

  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(hemi, sun, sun.target);

  // --- sky -----------------------------------------------------------------
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  const sunDir = new THREE.Vector3(6, 14, 7);
  const sunFocus = new THREE.Vector3();
  const cA = new THREE.Color(), cB = new THREE.Color();
  const mix = (a, b, t) => cA.set(a).lerp(cB.set(b), t).clone();

  function setMood(a, b = a, t = 0) {
    const A = MOODS[a], B = MOODS[b];
    const top = mix(A.top, B.top, t), horizon = mix(A.horizon, B.horizon, t);
    const g = skyCanvas.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `#${top.getHexString()}`);
    grd.addColorStop(0.62, `#${horizon.getHexString()}`);
    grd.addColorStop(1, `#${horizon.getHexString()}`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
    skyTex.needsUpdate = true;
    scene.fog.color.copy(horizon);
    sun.color.copy(mix(A.sun, B.sun, t));
    sun.intensity = THREE.MathUtils.lerp(A.sunI, B.sunI, t);
    hemi.color.copy(mix(A.hemiSky, B.hemiSky, t));
    hemi.groundColor.copy(mix(A.hemiGround, B.hemiGround, t));
    hemi.intensity = THREE.MathUtils.lerp(A.hemiI, B.hemiI, t);
    scene.environmentIntensity = THREE.MathUtils.lerp(A.env, B.env, t);
    sunDir.fromArray(A.sunDir).lerp(new THREE.Vector3().fromArray(B.sunDir), t);
    placeSun();
  }
  function placeSun() {
    sun.target.position.copy(sunFocus);
    sun.position.copy(sunFocus).addScaledVector(sunDir.clone().normalize(), 40);
  }
  /** Centre the shadow box on (x, z) and make it cover ±half metres. */
  function setShadowArea(x, z, half) {
    sunFocus.set(x, 0, z);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 90 });
    sun.shadow.camera.updateProjectionMatrix();
    placeSun();
  }
  setMood('day');
  setShadowArea(0, 0, 14);

  // --- characters ----------------------------------------------------------
  const res = await fetch('models/manifest.json');
  if (!res.ok) throw new Error('models/manifest.json is missing');
  const manifest = await res.json();
  const loader = new GLTFLoader();
  const assets = {};
  await Promise.all([loadScenery(), ...manifest.characters.map(async (entry) => {
    assets[entry.id] = { entry, gltf: await loader.loadAsync(entry.url) };
  })]);
  // Friendly handles: the penguin and the deer.
  const ids = Object.keys(assets);
  const WINO = ids.find((i) => /penguin/.test(i)) ?? ids[0];
  const COOKIE = ids.find((i) => i !== WINO) ?? ids[0];
  // In the playground Wino is twice Cookie's size; here they're closer so games are fair.
  const BASE = { [WINO]: { scale: 1.25 }, [COOKIE]: { scale: 1 } };

  // --- input ---------------------------------------------------------------
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last frame
  const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
    sfx.unlock();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('pointerdown', () => sfx.unlock());
  const input = {
    down: (...codes) => codes.some((c) => keys.has(c)),
    hit: (...codes) => codes.some((c) => pressed.has(c)),
    /** WASD / arrows as a world-space direction for a camera that looks along -Z. */
    move() {
      let x = 0, z = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
      const l = Math.hypot(x, z);
      return l ? { x: x / l, z: z / l } : { x: 0, z: 0 };
    },
  };

  // --- particles -----------------------------------------------------------
  const bitGeo = new THREE.BoxGeometry(1, 1, 0.3);
  const bitMats = new Map();
  const bits = [];
  function burst(pos, { count = 24, colors = [0xffd84d, 0xff7b6b, 0x7cc4f5, 0xffffff, 0xb79bff], speed = 5, up = 5, life = 1.3, size = 0.12, gravity = 12 } = {}) {
    for (let i = 0; i < count; i++) {
      const col = colors[i % colors.length];
      let mat = bitMats.get(col);
      if (!mat) bitMats.set(col, (mat = new THREE.MeshBasicMaterial({ color: col })));
      const m = new THREE.Mesh(bitGeo, mat);
      m.position.copy(pos);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed;
      scene.add(m);
      bits.push({ m, v: new THREE.Vector3(Math.cos(a) * r, up * (0.4 + Math.random() * 0.8), Math.sin(a) * r), life: life * (0.6 + Math.random() * 0.6), gravity, spin: (Math.random() - 0.5) * 14 });
    }
  }
  function updateBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt;
      b.v.y -= b.gravity * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += b.spin * dt; b.m.rotation.z += b.spin * 0.7 * dt;
      if (b.m.position.y < 0.03) { b.m.position.y = 0.03; b.v.set(0, 0, 0); b.spin = 0; }
      if (b.life < 0.25) b.m.scale.multiplyScalar(Math.max(0, 1 - dt * 6));
      if (b.life <= 0) { scene.remove(b.m); bits.splice(i, 1); }
    }
  }

  // --- HUD -----------------------------------------------------------------
  const el = { hud: $('hud'), left: $('hud-left'), right: $('hud-right'), center: $('hud-center'), banner: $('banner'), hint: $('hint') };
  let bannerTimer = 0;
  const hud = {
    show(on) { el.hud.hidden = !on; },
    /** Each part is HTML text, or null to hide it. */
    set({ left, right, center } = {}) {
      for (const [k, v] of [['left', left], ['right', right], ['center', center]]) {
        if (v === undefined) continue;
        el[k].hidden = v === null;
        if (v !== null && el[k].innerHTML !== String(v)) el[k].innerHTML = v;
      }
    },
    banner(text, seconds = 1.6) {
      el.banner.textContent = text;
      el.banner.classList.remove('pop');
      void el.banner.offsetWidth; // restart the animation
      el.banner.classList.add('pop');
      bannerTimer = seconds;
    },
    hint(html) { el.hint.innerHTML = html; },
  };

  // --- game lifecycle ------------------------------------------------------
  let current = null; // { def, game, root, chars, ctx, over }
  let paused = false;
  let onFinish = () => {};
  const camGoal = { pos: new THREE.Vector3(0, 10, 16), look: new THREE.Vector3() };
  const camLook = new THREE.Vector3();

  function stop() {
    if (!current) return;
    current.game.dispose?.();
    for (const c of current.chars) c.dispose();
    scene.remove(current.root);
    current.root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.isMesh && o.userData.own) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); }
    });
    for (const b of bits) scene.remove(b.m);
    bits.length = 0;
    current = null;
  }

  function start(def, options = {}) {
    stop();
    paused = false;
    const root = new THREE.Group();
    scene.add(root);
    const chars = [];
    const state = { def, root, chars, over: false, fresh: true };
    const ctx = {
      THREE, scene, root, camera, input, hud, sfx, burst, setMood, setShadowArea, WINO, COOKIE,
      auto: !!options.auto,
      /** The species the player picked, and the other one. */
      playerId: options.playerId ?? WINO,
      rivalId: (options.playerId ?? WINO) === WINO ? COOKIE : WINO,
      emoji: (id) => (id === WINO ? '🐧' : '🦌'),
      nameOf: (id) => assets[id].entry.name,
      colorOf: (id) => assets[id].entry.color,
      /** Add a stuffy to the scene, fabric shading on. */
      spawn(id, overrides = {}) {
        const { entry, gltf } = assets[id];
        const c = new Character(gltf, { ...entry, ...BASE[id], ...overrides });
        c.fabric = new FabricFX(c, entry.fabric);
        c.fabric.apply({ fabric: true, fuzz: false, furLength: 1 });
        root.add(c.root);
        chars.push(c);
        return c;
      },
      /** Mark a mesh as owned by this game so its geometry/material are freed afterwards. */
      own(mesh) { mesh.traverse((o) => { if (o.isMesh) o.userData.own = true; }); return mesh; },
      /** Ask the camera to glide to a position / look-at point. */
      cam(px, py, pz, lx, ly, lz, snap = false) {
        camGoal.pos.set(px, py, pz);
        camGoal.look.set(lx, ly, lz);
        if (snap) { camera.position.copy(camGoal.pos); camLook.copy(camGoal.look); camera.lookAt(camLook); }
      },
      /** End of the game: show the result card. */
      finish(result) {
        if (state.over) return;
        state.over = true;
        onFinish(result);
      },
      get over() { return state.over; },
    };
    state.ctx = ctx;
    current = state;
    hud.set({ left: null, right: null, center: null });
    hud.hint('');
    el.banner.classList.remove('pop');
    state.game = def.create(ctx);
    return state;
  }

  const speed = Math.max(1, Math.min(20, Number(new URLSearchParams(location.search).get('speed')) || 1));
  const timer = new THREE.Timer();
  timer.connect(document);
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 30);
    if (current && !paused) {
      for (let i = 0; i < speed; i++) current.game.update(dt); // ?speed=N fast-forwards (testing)
      updateBits(dt);
      const k = current.fresh ? 1 : 1 - Math.exp(-4 * dt);
      current.fresh = false;
      camera.position.lerp(camGoal.pos, k);
      camLook.lerp(camGoal.look, k);
      camera.lookAt(camLook);
      const clouds = current.root.getObjectByName('forest')?.userData.clouds;
      if (clouds) clouds.rotation.y += dt * 0.004;
      if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) el.banner.classList.remove('pop');
    }
    pressed.clear();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return {
    renderer, scene, camera, hud, input, WINO, COOKIE, assets,
    start, stop,
    get current() { return current; },
    get paused() { return paused; },
    setPaused(p) { paused = p; },
    onFinish(fn) { onFinish = fn; },
  };
}
