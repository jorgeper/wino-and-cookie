import * as THREE from 'three';
import { buildForest, makeMarker, mulberry32 } from '../forest.js';
import { separateCharacters } from '../physics.js';
import { chip, fmtTime, glowPoints, clamp } from './common.js';

const R = 9.5;         // how far from the middle you can wander
const COUNT = 48;      // fireflies in the air at once
const SWARMS = 7;
const TIME = 60;
const GREEN = [0.75, 1.0, 0.3], GOLD = [1.0, 0.62, 0.12];

function makeJar(color) {
  const jar = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.36, 14),
    new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  lid.position.y = 0.21;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }));
  const light = new THREE.PointLight(0xffe07a, 0, 9, 1.6);
  jar.add(glow, glass, lid, light);
  jar.userData = { glow, light };
  return jar;
}

export default {
  id: 'fireflies',
  title: 'Firefly Jars',
  emoji: '✨',
  blurb: 'Night in the clearing. Catch more fireflies than your friend before time runs out. Jump for the high ones; gold ones count triple.',
  controls: '<kbd>WASD</kbd> move · <kbd>Space</kbd> jump',
  touch: { buttons: [{ code: 'Space', label: 'Jump' }] },

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('night');
    ctx.setShadowArea(0, 0, 12);
    const forest = buildForest({ seed: 91, clearing: R + 2.5, trees: 110, deco: 1.3,
      // the clearing, plus the strip the camera looks in from
      keepOut: (x, z) => Math.hypot(x, z) < R + 1.2 || (z > 0 && z < R + 26 && Math.abs(x) < R + 2.5) });
    forest.name = 'forest';
    root.add(forest);

    // Night sky: stars and a moon, only when the lighting really is night.
    const rng = mulberry32(8);
    const stars = glowPoints(700, { additive: true });
    {
      const p = stars.geometry.attributes.position, s = stars.geometry.attributes.aSize, c = stars.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const a = rng() * Math.PI * 2, e = Math.asin(0.03 + rng() * rng() * 0.95), r = 330;
        p.setXYZ(i, Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
        s.setX(i, 1.6 + rng() * rng() * 4.5);
        const w = 0.55 + rng() * 0.45; c.setXYZ(i, w, w, w * (0.9 + rng() * 0.3));
      }
    }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf6f1d8, fog: false }));
    moon.position.set(-120, 27, -290); // low, so it peeks over the trees
    const sky = new THREE.Group();
    sky.add(stars, ctx.own(moon));
    root.add(sky);

    // --- fireflies -----------------------------------------------------------
    const flies = glowPoints(COUNT, { additive: true });
    root.add(flies);
    const fp = flies.geometry.attributes.position, fs = flies.geometry.attributes.aSize, fc = flies.geometry.attributes.color;
    const swarms = Array.from({ length: SWARMS }, (_, i) => ({ x: 0, z: 0, tx: 0, tz: 0, t: 0, high: i % 3 === 2 }));
    const roam = (s) => { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (R - 1.5); s.tx = Math.cos(a) * r; s.tz = Math.sin(a) * r; s.t = 5 + Math.random() * 6; };
    for (const s of swarms) { roam(s); s.x = s.tx; s.z = s.tz; roam(s); }
    const bugs = Array.from({ length: COUNT }, (_, i) => ({
      i, swarm: swarms[i % SWARMS], pos: new THREE.Vector3(), vel: new THREE.Vector3(), ph: Math.random() * 20, gold: i % 9 === 4, wait: 0, glow: 0,
    }));
    function release(b, first = false) {
      b.swarm = swarms[Math.floor(Math.random() * SWARMS)];
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.7;
      b.home = [Math.cos(a) * r, (b.swarm.high ? 2.0 : 0.55) + Math.random() * (b.swarm.high ? 0.7 : 1.0), Math.sin(a) * r];
      b.pos.set(b.swarm.x + b.home[0], b.home[1], b.swarm.z + b.home[2]);
      b.vel.set(0, 0, 0);
      b.glow = first ? 1 : 0;
    }
    for (const b of bugs) release(b, true);

    const mk = (id, x, mul) => {
      const c = ctx.spawn(id); c.speedMul = mul; c.place(x, 0, 0);
      const jar = ctx.own(makeJar(ctx.colorOf(id)));
      root.add(jar);
      return { c, jar, score: 0, target: null, think: 0 };
    };
    const P = mk(ctx.playerId, -2, 1), Q = mk(ctx.rivalId, 2, 0.84);
    const players = [P, Q], chars = [P.c, Q.c];
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    let left = TIME, time = 0, started = false;
    const v = new THREE.Vector3();
    hud.hint(this.controls);
    hud.banner('Catch the fireflies!', 1.4);

    function aiInput(p, dt) {
      if ((p.think -= dt) <= 0 || !p.target || p.target.wait > 0) {
        p.think = 0.35;
        let best = null, bd = 1e9;
        for (const b of bugs) {
          if (b.wait > 0) continue;
          const d = Math.hypot(b.pos.x - p.c.position.x, b.pos.z - p.c.position.z) / (b.gold ? 1.7 : 1) + (b.pos.y > 1.7 ? 1.5 : 0);
          if (d < bd) { bd = d; best = b; }
        }
        p.target = best;
      }
      const b = p.target;
      if (!b) return null;
      const dx = b.pos.x - p.c.position.x, dz = b.pos.z - p.c.position.z, d = Math.hypot(dx, dz) || 1;
      if (d < 0.9 && b.pos.y > p.c.height + 0.25 && p.c.grounded) p.c.jump();
      return { x: dx / d, z: dz / d, run: true };
    }

    return {
      get state() { return { a: P.score, b: Q.score, left }; },

      update(dt) {
        time += dt;
        if (!ctx.over && time > 1) { started = true; left -= dt; }

        for (const p of players) {
          let inp = null;
          if (started && !ctx.over) {
            if (p === P && !ctx.auto) {
              const m = input.move();
              if (input.hit('Space')) p.c.jump();
              inp = m.x || m.z ? { x: m.x, z: m.z, run: true } : null;
            } else inp = aiInput(p, dt);
          } else if (ctx.over && p.c.grounded && Math.random() < dt * 2 && p.score >= Math.max(P.score, Q.score)) p.c.hop(4);
          p.c.update(dt, inp);
          const d = Math.hypot(p.c.position.x, p.c.position.z);
          if (d > R) { p.c.position.x *= R / d; p.c.position.z *= R / d; }
        }
        separateCharacters(chars);

        for (const s of swarms) {
          if ((s.t -= dt) <= 0) roam(s);
          s.x += clamp(s.tx - s.x, -1, 1) * dt * 0.5; s.z += clamp(s.tz - s.z, -1, 1) * dt * 0.5;
        }
        for (const b of bugs) {
          if (b.wait > 0) {
            if ((b.wait -= dt) <= 0) release(b);
            fs.setX(b.i, 0);
            continue;
          }
          b.glow = Math.min(1, b.glow + dt * 0.8);
          // Drift around a spot in the swarm, and shy away from anyone who gets close.
          const t = time + b.ph, s = b.swarm;
          const gx = s.x + b.home[0] + Math.sin(t * 0.7) * 0.5, gy = b.home[1] + Math.sin(t * 1.1) * 0.22, gz = s.z + b.home[2] + Math.cos(t * 0.53) * 0.5;
          b.vel.x += (gx - b.pos.x) * 2.2 * dt; b.vel.y += (gy - b.pos.y) * 4 * dt; b.vel.z += (gz - b.pos.z) * 2.2 * dt;
          for (const p of players) {
            const dx = b.pos.x - p.c.position.x, dz = b.pos.z - p.c.position.z, d = Math.hypot(dx, dz);
            if (d < 2.0 && d > 0.001) { const push = (2.0 - d) * 11 * dt; b.vel.x += (dx / d) * push; b.vel.z += (dz / d) * push; }
            const y = b.pos.y - p.c.position.y;
            if (started && !ctx.over && d < p.c.radius + 0.3 && y > -0.1 && y < p.c.height + 0.4) {
              p.score += b.gold ? 3 : 1;
              b.wait = 5 + Math.random() * 7;
              ctx.burst(v.copy(b.pos), { count: b.gold ? 12 : 6, colors: b.gold ? [0xffc54a, 0xfff0a8] : [0xd8ff7a, 0xfff7c2], speed: 1.6, up: 1.8, life: 0.45, size: 0.05, gravity: 3 });
              if (p === P) (b.gold ? sfx.point : sfx.pop)(); else if (b.gold) sfx.blip();
              break;
            }
          }
          const drag = Math.exp(-2.4 * dt);
          b.vel.multiplyScalar(drag);
          b.pos.addScaledVector(b.vel, dt);
          b.pos.y = Math.max(0.3, b.pos.y);
          const tw = 0.55 + 0.45 * Math.sin(t * (b.gold ? 5 : 3.1) + Math.sin(t * 0.9) * 2);
          const col = b.gold ? GOLD : GREEN, k = b.glow * (0.35 + 0.65 * tw);
          fp.setXYZ(b.i, b.pos.x, b.pos.y, b.pos.z);
          fc.setXYZ(b.i, col[0] * k, col[1] * k, col[2] * k);
          fs.setX(b.i, (b.gold ? 0.52 : 0.36) * (0.8 + 0.2 * tw));
        }
        fp.needsUpdate = fc.needsUpdate = fs.needsUpdate = true;

        // Each jar floats by its owner's shoulder and shines brighter the fuller it is.
        for (const p of players) {
          const c = p.c, f = c.facing(v), fill = Math.min(1, p.score / 30);
          const tx = c.position.x - f.z * (c.radius + 0.32) - f.x * 0.1, tz = c.position.z + f.x * (c.radius + 0.32) - f.z * 0.1;
          const ty = c.position.y + c.height * 0.62 + Math.sin(time * 2.2 + (p === P ? 0 : 2)) * 0.05;
          const k = 1 - Math.exp(-9 * dt);
          p.jar.position.x += (tx - p.jar.position.x) * k; p.jar.position.y += (ty - p.jar.position.y) * k; p.jar.position.z += (tz - p.jar.position.z) * k;
          const { glow, light } = p.jar.userData;
          glow.scale.setScalar(0.25 + fill * 0.95);
          glow.visible = p.score > 0;
          light.intensity = p.score > 0 ? 1 + fill * 5 : 0;
        }

        if (left <= 0 && !ctx.over) {
          const won = P.score > Q.score, tie = P.score === Q.score;
          (won ? sfx.cheer : sfx.whistle)();
          ctx.finish({ title: tie ? 'A tie!' : won ? 'You win!' : 'So close!', text: `${ctx.emoji(P.c.id)} ${P.score} – ${Q.score} ${ctx.emoji(Q.c.id)} fireflies`, won });
        }

        // Stars and moon follow the camera so they never come closer; hidden if the Lighting setting forces daytime.
        const night = !['day', 'golden', 'dusk'].includes(ctx.graphics.settings.lighting);
        sky.visible = night;
        sky.position.copy(ctx.camera.position).setY(0);
        if (forest.userData.clouds) forest.userData.clouds.visible = !night;
        stars.sync(ctx); flies.sync(ctx);

        marker.position.set(P.c.position.x, 0.04, P.c.position.z);
        marker.scale.setScalar(P.c.radius * 1.5);
        marker.visible = !ctx.over;
        const px = P.c.position.x * 0.55, pz = P.c.position.z * 0.5;
        const back = Math.max(11.5, 17 / ctx.camera.aspect);
        ctx.cam(px, 5.6, pz + back + 1.5, px, 1.5, pz - 2);
        hud.set({
          left: chip(ctx.emoji(P.c.id), P.score, ctx.colorOf(P.c.id)),
          right: chip(ctx.emoji(Q.c.id), Q.score, ctx.colorOf(Q.c.id)),
          center: `⏱ ${fmtTime(left)}`,
        });
      },

      dispose() { stars.dispose(); flies.dispose(); },
    };
  },
};
