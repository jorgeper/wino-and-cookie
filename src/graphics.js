import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SHELL_LAYER } from './fabric.js';

/**
 * Every look-and-feel option in one place. Adapted from three-stuff-demo/src/graphics.js
 * and extended with the scenery and grass options. The settings gear (settings.js) edits
 * these; they are saved in the browser.
 */
export const DEFAULTS = Object.freeze({
  // Wino & Cookie
  fabric: true,          // plush fabric shading (sheen + pile pattern)
  fuzz: false,           // fuzzy fur shells
  furLength: 1,          // fur shell length multiplier
  // Scenery
  sceneryDetail: false,  // leaf / bark / stone shaders on the forest models
  sceneryStrength: 1,    // how strong those patterns are
  // Grass
  grass: true,
  grassDensity: 1,
  grassHeight: 1,
  wind: 1,               // sways grass and (with scenery detail) foliage
  // Light & shadow
  lighting: 'auto',      // auto = whatever the game asks for | day | golden | dusk
  shadows: 'standard',   // standard | soft | crisp
  ao: false,             // ambient occlusion (GTAO)
  // Camera
  view: 'front',         // soccer / volleyball: front = from behind your side, side = from the sideline
  aa: 'msaa',            // msaa | smaa | ssaa
  tiltShift: false,      // toy-camera depth of field
  grade: false,          // cozy colour grade + vignette + grain
});

const STORE = 'wino-and-cookie-graphics';

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { /* private window / bad JSON */ }
  const s = { ...DEFAULTS };
  // Only keep saved values that still make sense (same key, same type).
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private window */ }
}

// Warm, slightly saturated grade with a soft vignette and a whisper of film grain.
const CozyGradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.14);                           // a touch more colour
      c.rgb *= vec3(1.04, 1.0, 0.95);                              // warm
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.2); // gentle S-curve
      c.rgb += vec3(0.02, 0.012, 0.0) * (1.0 - l);                 // lift shadows slightly warm
      float v = smoothstep(0.9, 0.3, length((vUv - 0.5) * vec2(1.15, 1.0)));
      c.rgb *= mix(0.84, 1.0, v);                                  // vignette
      float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.016;                                  // grain
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class Graphics {
  constructor({ renderer, scene, camera, sun, basePixelRatio }) {
    Object.assign(this, { renderer, scene, camera, sun, basePixelRatio });
    this.settings = { ...DEFAULTS };
    this.composer = null;
    this.listeners = new Set();
    this.paused = false; // photo mode takes over the canvas
  }

  /** fn(settings, previousSettings) runs after every change. */
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get usesComposer() {
    const s = this.settings;
    return s.ao || s.tiltShift || s.grade || s.aa === 'smaa';
  }

  set(next) {
    const prev = this.settings;
    const s = (this.settings = { ...prev, ...next });
    if (s.shadows !== prev.shadows || !this.started) this.applyShadows();
    if (s.aa !== prev.aa || !this.started) this.applyPixelRatio();
    const post = (x) => `${x.ao}|${x.tiltShift}|${x.grade}|${x.aa}`;
    if (post(s) !== post(prev) || !this.started) this.rebuildComposer();
    this.started = true;
    for (const fn of this.listeners) fn(s, prev);
  }

  applyShadows() {
    const { renderer, sun, scene } = this;
    const mode = this.settings.shadows;
    renderer.shadowMap.type = mode === 'soft' ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    const size = mode === 'crisp' ? 4096 : 2048;
    sun.shadow.radius = mode === 'soft' ? 12 : mode === 'crisp' ? 1.5 : 4;
    sun.shadow.blurSamples = 16;
    sun.shadow.bias = mode === 'soft' ? -0.0008 : -0.0003;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    // Shadow type is baked into shaders: recompile.
    scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.needsUpdate = true;
    });
  }

  applyPixelRatio() {
    const pr = this.settings.aa === 'ssaa' ? Math.min(this.basePixelRatio * 1.5, 3) : this.basePixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
  }

  rebuildComposer() {
    this.composer?.dispose();
    this.composer = null;
    this.bokeh = this.gradePass = null;
    if (!this.usesComposer) return;
    const { renderer, scene, camera } = this;
    const s = this.settings;
    const w = innerWidth, h = innerHeight;
    // Keep hardware MSAA inside the composer unless SMAA replaces it.
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: s.aa === 'smaa' ? 0 : 4 });
    const composer = new EffectComposer(renderer, target);
    // Post effects are fill-rate heavy; 1.5x density looks the same once blur/AO are in play.
    composer.setPixelRatio(this.composerPixelRatio());
    composer.setSize(w, h);
    // Fur shells and grass live on their own layer: draw them in the colour pass only. The AO
    // and depth-of-field passes re-render the scene and don't need them.
    const renderPass = new RenderPass(scene, camera);
    const renderScene = renderPass.render.bind(renderPass);
    renderPass.render = (...args) => {
      camera.layers.enable(SHELL_LAYER);
      renderScene(...args);
      camera.layers.disable(SHELL_LAYER);
    };
    composer.addPass(renderPass);

    if (s.ao) {
      const ao = new GTAOPass(scene, camera, w, h);
      // AO is soft and low-frequency: compute it at half resolution (about 4x cheaper).
      const fullSetSize = ao.setSize.bind(ao);
      ao.setSize = (sw, sh) => fullSetSize(Math.ceil(sw / 2), Math.ceil(sh / 2));
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12 });
      ao.blendIntensity = 1;
      composer.addPass(ao);
    }
    if (s.tiltShift) {
      this.bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0.0009, maxblur: 0.006 });
      composer.addPass(this.bokeh);
    }
    composer.addPass(new OutputPass()); // tone mapping + sRGB
    if (s.grade) {
      this.gradePass = new ShaderPass(CozyGradeShader);
      composer.addPass(this.gradePass);
    }
    if (s.aa === 'smaa') composer.addPass(new SMAAPass(w * this.composerPixelRatio(), h * this.composerPixelRatio()));
    this.composer = composer;
  }

  composerPixelRatio() {
    return this.settings.aa === 'ssaa' ? this.renderer.getPixelRatio() : Math.min(this.renderer.getPixelRatio(), 1.5);
  }

  resize() {
    this.applyPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(this.composerPixelRatio());
      this.composer.setSize(innerWidth, innerHeight);
    }
  }

  /** @param {number} focusDistance distance from the camera to what should be sharp */
  render(focusDistance) {
    if (this.paused) return;
    if (!this.composer) {
      this.camera.layers.enable(SHELL_LAYER);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.camera.layers.disable(SHELL_LAYER);
    if (this.bokeh) this.bokeh.uniforms.focus.value = focusDistance;
    if (this.gradePass) this.gradePass.uniforms.uTime.value = (performance.now() / 1000) % 100;
    this.composer.render();
  }
}
