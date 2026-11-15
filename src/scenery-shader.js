import * as THREE from 'three';

/*
 * Procedural surface detail for the forest models ("Scenery detail" in the settings).
 *
 * Each model is one mesh with one painted texture, so the shader decides what a pixel is
 * from its painted colour: saturated green (or, for the maple, saturated red/orange) is
 * foliage; everything else is that model's base surface (bark or stone).
 *
 *   foliage  overlapping leaf clumps, a soft glow where the sun shines through, wind sway
 *   bark     vertical grooves and ridges; dark horizontal streaks on pale (birch) bark
 *   stone    speckle and thin cracks
 *
 * Patterns are laid out in metres in the model's upright space, so leaves are the same
 * size on a small tree and a big one, and they fade out when smaller than a pixel.
 * With the setting off the output is exactly the plain painted material.
 */

/** Shared by every scenery material: change the values, not the objects. */
export const sceneryUniforms = {
  uScnDetail: { value: 0 },   // 0 = off, otherwise pattern strength
  uScnTime: { value: 0 },
  uScnWind: { value: 1 },
};

// foliage: [green counts, warm colours count, upper part counts, everything counts]
export const SCENERY_KINDS = {
  'pine-tree': { foliage: [1, 0, 1, 0], base: 1, trunkTop: 0.3, sway: 0.7 },
  'birch-tree': { foliage: [1, 0, 1, 0], base: 1, trunkTop: 0.5, sway: 1 },
  'maple-tree': { foliage: [1, 1, 1, 0], base: 1, trunkTop: 0.5, sway: 1 },
  'rounded-bush': { foliage: [0, 0, 0, 1], base: 0, sway: 0.5 },
  'rock': { foliage: [1, 0, 0, 0], base: 2 },
  'mossy-boulder': { foliage: [1, 0, 0, 0], base: 2 },
  'tree-stump': { foliage: [1, 0, 0, 0], base: 1 },
  'mushroom-cluster': { foliage: [1, 0, 0, 0], base: 0, sheen: 1 },
  'wildflower-clump': { foliage: [1, 0, 0, 0], base: 0, sheen: 0.6, sway: 1.2 },
  log: { foliage: [0, 0, 0, 0], base: 1 },
};

const NOISE = /* glsl */ `
  vec3 scnHash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  // Cellular noise: x = distance to the nearest point, y = distance to the second nearest, z = cell id.
  vec3 scnWorley(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = scnHash3(i + g);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = o.x; } else if (d < d2) { d2 = d; }
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
  float scnValue(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = scnHash3(i).x, b = scnHash3(i + vec3(1,0,0)).x, c = scnHash3(i + vec3(0,1,0)).x, d = scnHash3(i + vec3(1,1,0)).x;
    float e = scnHash3(i + vec3(0,0,1)).x, g = scnHash3(i + vec3(1,0,1)).x, h = scnHash3(i + vec3(0,1,1)).x, k = scnHash3(i + vec3(1,1,1)).x;
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }
`;

/**
 * Add the detail shader to a MeshStandardMaterial.
 * @param kind   key of SCENERY_KINDS
 * @param scale  for plain (non-instanced) meshes: the mesh's scale, so patterns are in metres
 */
export function applySceneryShader(material, kind, scale = [1, 1, 1]) {
  const k = { sway: 0, sheen: 0, trunkTop: 0.5, ...(SCENERY_KINDS[kind] || SCENERY_KINDS.rock) };
  const uniforms = {
    ...sceneryUniforms,
    uScnFoliage: { value: new THREE.Vector4(...k.foliage) },
    uScnBase: { value: k.base },
    uScnTrunkTop: { value: k.trunkTop },
    uScnSway: { value: k.sway },
    uScnSheen: { value: k.sheen },
    uScnScale: { value: new THREE.Vector3(...scale) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vScnPos;
        varying float vScnY;
        uniform vec3 uScnScale;
        uniform float uScnSway, uScnTime, uScnWind, uScnDetail;`)
      .replace('#include <project_vertex>', /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        vScnY = position.y;
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vScnPos = mvPosition.xyz;
          if (uScnDetail > 0.0 && uScnSway > 0.0) {
            // The whole crown leans with slow gusts; leaves shiver on top of that.
            vec2 origin = instanceMatrix[3].xz;
            float tall = length(instanceMatrix[1].xyz);
            float lift = smoothstep(0.12, 1.0, position.y);
            float gust = sin(dot(origin, vec2(0.21, 0.17)) + uScnTime * 1.1) + 0.5 * sin(dot(origin, vec2(-0.13, 0.29)) + uScnTime * 1.9);
            vec2 lean = vec2(0.8, 0.6) * gust * 0.014 * tall * lift * lift;
            vec3 q = vScnPos * 2.6;
            vec2 shiver = vec2(sin(q.y + q.z + uScnTime * 3.1), cos(q.x + q.y + uScnTime * 2.7)) * 0.012 * lift * min(tall, 2.0);
            mvPosition.xz += (lean + shiver) * uScnSway * uScnWind;
          }
        #else
          vScnPos = position * uScnScale;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE}
        varying vec3 vScnPos;
        varying float vScnY;
        uniform vec4 uScnFoliage;
        uniform float uScnBase, uScnTrunkTop, uScnSheen, uScnDetail;
        float scnFol = 0.0;   // how much this pixel is foliage
        float scnBump = 0.0;  // procedural height, metres`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
        if (uScnDetail > 0.0) {
          vec3 tex = sqrt(max(diffuseColor.rgb, 0.0)); // roughly back to how it was painted
          float mx = max(tex.r, max(tex.g, tex.b)), mn = min(tex.r, min(tex.g, tex.b));
          float sat = (mx - mn) / (mx + 1e-4);
          float green = smoothstep(0.03, 0.12, tex.g - max(tex.r, tex.b));
          float warm = smoothstep(0.62, 0.82, sat) * smoothstep(0.5, 0.68, mx);
          float upper = smoothstep(uScnTrunkTop, uScnTrunkTop + 0.14, vScnY);
          scnFol = clamp(max(max(uScnFoliage.x * green, uScnFoliage.y * warm), uScnFoliage.z * upper) + uScnFoliage.w, 0.0, 1.0);
          vec3 p = vScnPos;
          float px = length(fwidth(p)); // metres per pixel
          float tone = 1.0;

          if (scnFol > 0.01) { // leaf clumps
            vec3 q = p * 8.0;
            float fade = 1.0 - smoothstep(0.3, 1.0, px * 8.0);
            vec3 w1 = scnWorley(q);
            vec3 w2 = scnWorley(q * 2.3 + 3.7);
            float clump = 1.0 - smoothstep(0.1, 0.75, w1.x);
            float edge = 0.45 + 0.55 * smoothstep(0.0, 0.22, w1.y - w1.x); // soft dark seam where two clumps meet
            float h = clamp(clump * 0.65 + (1.0 - smoothstep(0.1, 0.7, w2.x)) * 0.35, 0.0, 1.0) * edge;
            float t = mix(0.76, 1.13, h) * (0.86 + 0.3 * w1.z);
            tone = mix(tone, mix(1.0, t, fade), scnFol);
            scnBump += h * 0.02 * fade * scnFol;
          }
          if (scnFol < 0.99 && uScnBase > 0.5) {
            float t = 1.0, h = 0.0;
            if (uScnBase < 1.5) { // bark
              vec3 b = vec3(p.x * 24.0, p.y * 3.2, p.z * 24.0);
              float fade = 1.0 - smoothstep(0.3, 1.0, px * 24.0);
              float g1 = scnValue(b), g2 = scnValue(b * 2.7 + 5.0);
              float ridge = 1.0 - abs(2.0 * g1 - 1.0);
              h = clamp(ridge * 0.75 + g2 * 0.25, 0.0, 1.0);
              t = mix(0.66, 1.12, h);
              float pale = smoothstep(0.55, 0.75, mn);              // birch: dark horizontal dashes
              float dash = smoothstep(0.66, 0.74, scnValue(vec3(p.x * 4.0, p.y * 34.0, p.z * 4.0)));
              t *= mix(1.0, 0.5, dash * pale);
              t = mix(1.0, t, fade);
              h *= 0.012 * fade;
            } else { // stone
              float fade = 1.0 - smoothstep(0.3, 1.0, px * 40.0);
              float coarse = scnValue(p * 9.0), fine = scnValue(p * 55.0);
              vec3 w = scnWorley(p * 4.5 + 1.3);
              float crack = (1.0 - smoothstep(0.0, 0.05, w.y - w.x)) * (1.0 - smoothstep(0.3, 1.0, px * 30.0));
              t = (0.86 + 0.26 * coarse) * mix(1.0, 0.9 + 0.2 * fine, fade) * mix(1.0, 0.55, crack);
              h = (coarse * 0.5 + fine * 0.3 * fade - crack) * 0.008;
            }
            tone = mix(tone, t, 1.0 - scnFol);
            scnBump += h * (1.0 - scnFol);
          }
          float amount = min(uScnDetail, 2.0);
          diffuseColor.rgb *= max(mix(1.0, tone, amount), 0.0);
          scnBump *= amount;
        }`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        if (uScnDetail > 0.0) {
          // Bump-map the procedural height using screen-space derivatives.
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhdx = dFdx(scnBump), dhdy = dFdy(scnBump);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        if (uScnDetail > 0.0) {
          #if NUM_DIR_LIGHTS > 0
            // Sunlight glowing through leaves on the side facing away from the sun.
            float through = clamp(-dot(normal, directionalLights[0].direction), 0.0, 1.0);
            reflectedLight.directDiffuse += material.diffuseColor * directionalLights[0].color * vec3(1.0, 1.0, 0.55)
              * (through * 0.3 * scnFol * RECIPROCAL_PI);
          #endif
          float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          reflectedLight.indirectDiffuse += material.diffuseColor * rim * 0.35 * uScnSheen;
        }`);
  };
  material.customProgramCacheKey = () => 'scenery-detail-v1';
  return material;
}
