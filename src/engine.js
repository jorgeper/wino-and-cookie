import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character } from './character.js';
import { FabricFX } from './fabric.js';
import { sfx } from './audio.js';
import { loadScenery } from './forest.js';
import { Graphics, loadSettings, saveSettings } from './graphics.js';
import { sceneryUniforms } from './scenery-shader.js';
import { grassUniforms, groundUniforms, applyGrassSettings, updateGrassDetail, MAX_PUSHERS } from './grass.js';

// Sky / light moods. Games pick one, or blend between two (the herding game's sunset).
export const MOODS = {
  day: { top: 0x7cc4f5, horizon: 0xe6f6ff, sun: 0xfff1d6, sunI: 3.0, hemiSky: 0xe4f2ff, hemiGround: 0x86b56c, hemiI: 1.05, env: 0.35, sunDir: [6, 14, 7] },
  golden: { top: 0x9cc3e8, horizon: 0xffe6c2, sun: 0xffd09a, sunI: 3.1, hemiSky: 0xffeedd, hemiGround: 0x8fae68, hemiI: 0.9, env: 0.3, sunDir: [10, 9, 6] },
  dusk: { top: 0x4a5596, horizon: 0xf8b189, sun: 0xffa56e, sunI: 2.3, hemiSky: 0xb3b2e6, hemiGround: 0x7a8f66, hemiI: 0.9, env: 0.26, sunDir: [12, 5, 4] },
  night: { top: 0x070b24, horizon: 0x1c2852, sun: 0x9fb4ff, sunI: 0.5, hemiSky: 0x2c3a78, hemiGround: 0x101c24, hemiI: 0.38, env: 0.04, sunDir: [-5, 9, -8], fog: [22, 90] },
  winter: { top: 0x9db7d9, horizon: 0xe9eff7, sun: 0xfff3e2, sunI: 2.5, hemiSky: 0xe2ecff, hemiGround: 0xc4d0e2, hemiI: 1.15, env: 0.4, sunDir: [-7, 10, 6], fog: [28, 115] },
  // Indoor looks for the Testing Ground (plain backdrop, from three-stuff-demo).
  studio: { top: 0xeef0f3, horizon: 0xeef0f3, sun: 0xffffff, sunI: 3.0, hemiSky: 0xffffff, hemiGround: 0xb9c1ce, hemiI: 0.9, env: 0.35, sunDir: [3, 14, 4.5], fog: [35, 140] },
  warm: { top: 0xf1e6da, horizon: 0xf1e6da, sun: 0xffd3a6, sunI: 3.0, hemiSky: 0xfff0dd, hemiGround: 0xc2b4a8, hemiI: 0.85, env: 0.3, sunDir: [10, 7, 5], fog: [30, 120] },
  overcast: { top: 0xe7ebf0, horizon: 0xe7ebf0, sun: 0xffffff, sunI: 1.1, hemiSky: 0xf5f8fc, hemiGround: 0xc9d0da, hemiI: 1.7, env: 0.5, sunDir: [2, 14, 3], fog: [30, 120] },
  bedtime: { top: 0x232a40, horizon: 0x232a40, sun: 0xffb36b, sunI: 1.2, hemiSky: 0x6f7fb8, hemiGround: 0x2a2840, hemiI: 0.45, env: 0.12, sunDir: [-4, 9, 5], fog: [6, 28] },
};
const FOG = [40, 150];
const OUTDOOR = ['day', 'golden', 'dusk', 'night'];

const $ = (id) => document.getElementById(id);

export async function createEngine() {
  const app = $('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const basePixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(basePixelRatio);
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

  let graphics = null; // created further down, once there is something to apply settings to
  let mood = ['day', 'day', 0, false];
  /**
   * @param fixed true for looks the "Lighting" setting must not replace (the Testing Ground's room)
   */
  function setMood(a, b = a, t = 0, fixed = false) {
    mood = [a, b, t, fixed];
    const forced = !fixed && OUTDOOR.includes(graphics?.settings.lighting) ? graphics.settings.lighting : null;
    if (forced) { a = b = forced; t = 0; }
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
    const fa = A.fog ?? FOG, fb = B.fog ?? FOG;
    scene.fog.near = THREE.MathUtils.lerp(fa[0], fb[0], t);
    scene.fog.far = THREE.MathUtils.lerp(fa[1], fb[1], t);
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
  // Mouse / touch on the game itself (not on buttons or panels), for games that aim by dragging.
  const pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
  const cv = renderer.domElement;
  const track = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; };
  cv.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; track(e); pointer.down = pointer.pressed = true; cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener('pointermove', track);
  const lift = (e) => { if (!pointer.down) return; track(e); pointer.down = false; pointer.released = true; };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  const input = {
    /** Position in CSS pixels; `pressed` / `released` are true for the one frame it happens. */
    pointer,
    down: (...codes) => codes.some((c) => keys.has(c)),
    hit: (...codes) => codes.some((c) => pressed.has(c)),
    /** Set by a game whose camera looks along +X (from behind the player's side) instead of -Z. */
    front: false,
    /** WASD / arrows as a world-space direction, relative to where the camera looks. */
    move() {
      let x = 0, z = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
      const l = Math.hypot(x, z);
      if (!l) return { x: 0, z: 0 };
      return this.front ? { x: -z / l, z: x / l } : { x: x / l, z: z / l };
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
    input.front = false;
    sceneryUniforms.uScnSnow.value = groundUniforms.uGroundSnow.value = 0;
    const root = new THREE.Group();
    scene.add(root);
    const chars = [];
    const state = { def, root, chars, over: false, fresh: true };
    const ctx = {
      THREE, scene, root, camera, renderer, graphics, input, hud, sfx, burst, setMood, setShadowArea, WINO, COOKIE,
      ids,
      entryOf: (id) => assets[id].entry,
      /** True when the "Game view" setting asks for the view from behind the player's side. Also turns the keys to match. */
      get frontView() { return (input.front = graphics.settings.view === 'front'); },
      /** Cover the forest in snow (0..1). Reset when the next game starts. */
      setSnow(amount) { sceneryUniforms.uScnSnow.value = groundUniforms.uGroundSnow.value = amount; },
      /** Set to true by a game that drives the camera itself (the Testing Ground). */
      freeCamera: false,
      /** Distance from the camera to what should be sharp (toy camera). */
      focusDistance: null,
      auto: !!options.auto,
      /** The species the player picked, and the other one. */
      playerId: options.playerId ?? WINO,
      rivalId: (options.playerId ?? WINO) === WINO ? COOKIE : WINO,
      emoji: (id) => (id === WINO ? '🐧' : '🦌'),
      nameOf: (id) => assets[id].entry.name,
      colorOf: (id) => assets[id].entry.color,
      /** Add a stuffy to the scene, dressed the way the settings say. */
      spawn(id, overrides = {}) {
        const { entry, gltf } = assets[id];
        const c = new Character(gltf, { ...entry, ...BASE[id], ...overrides });
        c.fabric = new FabricFX(c, entry.fabric);
        c.fabric.apply(fabricOf(graphics.settings));
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
    root.traverse((o) => { if (o.name === 'grass') { state.grass = o; applyGrassSettings(o, graphics.settings); } });
    return state;
  }

  // --- graphics settings (the gear) ------------------------------------------
  graphics = new Graphics({ renderer, scene, camera, sun, basePixelRatio });
  const fabricOf = (s) => ({ fabric: s.fabric, fuzz: s.fuzz, furLength: s.furLength });
  graphics.onChange((s, prev) => {
    sceneryUniforms.uScnDetail.value = s.sceneryDetail ? s.sceneryStrength : 0;
    sceneryUniforms.uScnWind.value = s.wind;
    grassUniforms.uGrassWind.value = s.wind;
    grassUniforms.uGrassHeight.value = s.grassHeight;
    groundUniforms.uGroundGrass.value = s.grass ? 1 : 0;
    if (s.lighting !== prev.lighting) setMood(...mood);
    if (current) {
      for (const c of current.chars) c.fabric?.apply(fabricOf(s));
      current.root.traverse((o) => { if (o.name === 'grass') applyGrassSettings(o, s); });
    }
    saveSettings(s);
  });
  graphics.set(loadSettings());

  const speed = Math.max(1, Math.min(20, Number(new URLSearchParams(location.search).get('speed')) || 1));
  const timer = new THREE.Timer();
  timer.connect(document);
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 30);
    if (current && !paused) {
      for (let i = 0; i < speed; i++) current.game.update(dt); // ?speed=N fast-forwards (testing)
      updateBits(dt);
      grassUniforms.uGrassTime.value = sceneryUniforms.uScnTime.value = (sceneryUniforms.uScnTime.value + dt) % 3600;
      // Whoever is on the ground presses the grass down around them.
      const push = grassUniforms.uGrassPush.value;
      const pushers = Math.min(current.chars.length, MAX_PUSHERS);
      for (let i = 0; i < pushers; i++) {
        const c = current.chars[i];
        push[i].set(c.position.x, c.position.y, c.position.z, c.radius * 1.5 + 0.12);
      }
      grassUniforms.uGrassPushCount.value = pushers;
      const k = current.fresh ? 1 : 1 - Math.exp(-4 * dt);
      current.fresh = false;
      if (!current.ctx.freeCamera) {
        camera.position.lerp(camGoal.pos, k);
        camLook.lerp(camGoal.look, k);
        camera.lookAt(camLook);
      }
      const clouds = current.root.getObjectByName('forest')?.userData.clouds;
      if (clouds) clouds.rotation.y += dt * 0.004;
      if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) el.banner.classList.remove('pop');
    }
    pressed.clear();
    pointer.pressed = pointer.released = false;
    if (current?.grass) updateGrassDetail(current.grass, camera);
    graphics.render(current?.ctx.focusDistance ?? camera.position.distanceTo(camLook));
    current?.game.afterRender?.();
  }
  renderer.setAnimationLoop(frame);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    graphics.resize();
    current?.game.resize?.();
  });

  return {
    renderer, scene, camera, hud, input, WINO, COOKIE, assets, graphics,
    start, stop,
    get current() { return current; },
    get paused() { return paused; },
    setPaused(p) { paused = p; },
    onFinish(fn) { onFinish = fn; },
  };
}
