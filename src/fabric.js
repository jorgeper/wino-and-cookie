import * as THREE from 'three';

/*
 * Stylised plush fabric, in two optional layers (both toggled from the Graphics panel):
 *
 *  1. Fabric shading: swaps each material for a MeshPhysicalMaterial with
 *     - "sheen" (the soft bright rim that velvet / terry cloth gets at grazing angles)
 *     - a procedural pile pattern (round loops for terry, fine pile for velour) that
 *       bumps the normal and darkens the gaps between loops
 *     The pattern lives in the mesh's own (bind-pose) coordinates, so it sticks to the
 *     body while it animates. It fades out when it gets smaller than a pixel, so it
 *     never shimmers.
 *
 *  2. Fuzz shells: a few copies of the skinned mesh, each pushed out a little along the
 *     normal, with most pixels cut away so only "strands" remain. Stacked up they read
 *     as a short furry pile and soften the silhouette, the classic game fur trick.
 *
 * Presets are picked per character (and per material) in characters/characters.json:
 *   "fabric": "velour"                                     whole character
 *   "fabric": { "default": "terry", "materials": { "<material name>": "felt" } }
 */

// Sizes are in model units (meters at 1x scale); scale grows them with the character.
export const SHELL_LAYER = 1;

export const FABRICS = {
  terry: { // looped towel-like pile (Wino)
    loopScale: 70, bumpHeight: 0.004, gapShade: 0.34, fiber: 0.35,
    sheen: 0.55, sheenRoughness: 0.8, shells: 8, shellLength: 0.009, strandScale: 115,
  },
  velour: { // short, dense, soft pile with a strong sheen (Cookie)
    loopScale: 170, bumpHeight: 0.0009, gapShade: 0.1, fiber: 0.25,
    sheen: 0.9, sheenRoughness: 0.42, shells: 6, shellLength: 0.006, strandScale: 360,
  },
  felt: { // dense pressed fibres (beak, feet)
    loopScale: 260, bumpHeight: 0.0005, gapShade: 0.05, fiber: 0.3,
    sheen: 0.25, sheenRoughness: 0.9, shells: 0, shellLength: 0, strandScale: 300,
  },
};

const NOISE_GLSL = /* glsl */ `
  varying vec3 vFabricPos;
  vec3 fabHash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  // Cellular noise: x = distance to the nearest cell point, y = that cell's random id.
  vec2 fabWorley(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float best = 8.0, id = 0.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = fabHash3(i + g);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < best) { best = d; id = o.x; }
    }
    return vec2(sqrt(best), id);
  }
  float fabValue(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fabHash3(i).x, b = fabHash3(i + vec3(1,0,0)).x, c = fabHash3(i + vec3(0,1,0)).x, d = fabHash3(i + vec3(1,1,0)).x;
    float e = fabHash3(i + vec3(0,0,1)).x, g = fabHash3(i + vec3(1,0,1)).x, h = fabHash3(i + vec3(0,1,1)).x, k = fabHash3(i + vec3(1,1,1)).x;
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }
`;

function makeFabricMaterial(orig, preset, scale) {
  const m = new THREE.MeshPhysicalMaterial({
    name: `${orig.name}:fabric`,
    map: orig.map,
    color: orig.color.clone(),
    roughness: Math.max(orig.roughness ?? 1, 0.85),
    metalness: 0,
    normalMap: orig.normalMap,
    sheen: preset.sheen,
    sheenRoughness: preset.sheenRoughness,
    sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.75),
    envMapIntensity: 0.8,
  });
  const uniforms = {
    uLoopScale: { value: preset.loopScale },
    uBumpHeight: { value: preset.bumpHeight * scale },
    uGapShade: { value: preset.gapShade },
    uFiber: { value: preset.fiber },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabricPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabricPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        uniform float uLoopScale, uBumpHeight, uGapShade, uFiber;
        float fabricH;
        float fabricFade;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 p = vFabricPos * uLoopScale;
          // Fade the pattern out where a loop is smaller than ~a pixel (no shimmer at distance).
          fabricFade = 1.0 - smoothstep(0.35, 1.1, length(fwidth(p)));
          vec2 w1 = fabWorley(p);
          vec2 w2 = fabWorley(p * 2.3 + 7.1);
          float loops = 1.0 - smoothstep(0.12, 0.78, w1.x);
          float small = 1.0 - smoothstep(0.1, 0.7, w2.x);
          float fiber = fabValue(p * 7.0);
          fabricH = clamp(loops * 0.72 + small * 0.28 + (fiber - 0.5) * uFiber, 0.0, 1.0);
          // darker in the gaps between loops, a little lighter on the loop tops
          float near = mix(1.0 - uGapShade, 1.0 + uGapShade * 0.25, fabricH);
          float far = 1.0 - uGapShade * 0.35;
          diffuseColor.rgb *= mix(far, near, fabricFade);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Bump-map the procedural height using screen-space derivatives.
          float hh = fabricH * uBumpHeight * fabricFade;
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhdx = dFdx(hh), dhdy = dFdy(hh);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  m.customProgramCacheKey = () => 'plush-fabric-v1';
  return m;
}

function makeShellMaterial(orig, preset, layer, lengthUniform) {
  const m = new THREE.MeshStandardMaterial({
    name: `${orig.name}:shell`,
    map: orig.map,
    color: orig.color.clone(),
    roughness: 1,
    metalness: 0,
  });
  const uniforms = {
    uLayer: { value: layer },
    uShellLength: lengthUniform,
    uStrandScale: { value: preset.strandScale },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabricPos;\nuniform float uLayer, uShellLength;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabricPos = position;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * uShellLength * uLayer;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        uniform float uLayer, uStrandScale;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 p = vFabricPos * uStrandScale;
          if (length(fwidth(p)) > 1.2) discard;                 // too far away to see strands
          vec2 s = fabWorley(p);
          float radius = mix(0.55, 0.14, uLayer) * (0.7 + 0.6 * s.y); // strands taper to the tip
          if (s.x > radius || s.y < uLayer * 0.6) discard;       // some strands are shorter
          diffuseColor.rgb *= mix(0.74, 1.08, uLayer);           // darker at the roots
        }`);
  };
  m.customProgramCacheKey = () => 'plush-shell-v1';
  return m;
}

function presetFor(config, materialName) {
  if (!config) return 'velour';
  if (typeof config === 'string') return config;
  return config.materials?.[materialName] ?? config.default ?? 'velour';
}

export class FabricFX {
  constructor(character, config) {
    this.character = character;
    this.config = config;
    this.entries = null;
    this.furLength = { value: 1 };
  }

  build() {
    const c = this.character;
    this.entries = [];
    const meshes = [];
    c.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const mesh of meshes) {
      const orig = mesh.material;
      // Leave shiny bits (the eyes) alone.
      if (Array.isArray(orig) || /eye/i.test(orig.name) || (orig.roughness ?? 1) < 0.45) continue;
      const preset = FABRICS[presetFor(this.config, orig.name)] || FABRICS.velour;
      const entry = { mesh, orig, fabric: makeFabricMaterial(orig, preset, c.scale), shells: [], preset };
      if (preset.shells > 0 && mesh.isSkinnedMesh) {
        entry.lengthUniform = { value: preset.shellLength };
        for (let i = 1; i <= preset.shells; i++) {
          const shell = new THREE.SkinnedMesh(mesh.geometry, makeShellMaterial(orig, preset, i / preset.shells, entry.lengthUniform));
          shell.bind(mesh.skeleton, mesh.bindMatrix);
          shell.position.copy(mesh.position);
          shell.quaternion.copy(mesh.quaternion);
          shell.scale.copy(mesh.scale);
          shell.frustumCulled = false;
          shell.castShadow = false;
          shell.receiveShadow = true;
          shell.visible = false;
          shell.renderOrder = i;
          shell.layers.set(SHELL_LAYER); // only the main colour pass draws fur (not AO / depth-of-field)
          mesh.parent.add(shell);
          entry.shells.push(shell);
        }
      }
      this.entries.push(entry);
    }
  }

  /** @param {{fabric: boolean, fuzz: boolean, furLength: number}} s */
  apply(s) {
    if (!this.entries) {
      if (!s.fabric && !s.fuzz) return; // never built: nothing to undo
      this.build();
    }
    for (const e of this.entries) {
      e.mesh.material = s.fabric ? e.fabric : e.orig;
      for (const sh of e.shells) sh.visible = s.fuzz;
      if (e.lengthUniform) e.lengthUniform.value = e.preset.shellLength * s.furLength;
    }
  }
}
