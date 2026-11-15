import * as THREE from 'three';
import { buildForest, makeMarker, makeBlobShadow, mulberry32 } from '../forest.js';
import { chip, clamp, glowPoints, makeDots, toward } from './common.js';

const WALL_X = 4.2;                 // each fort's wall is this far from the middle
const ZONE = [5.3, 10.5];           // where you can stand, measured from the middle
const HALF_Z = 5.2;
const G = 16, ANGLE = 0.7;          // snowballs are lobbed at a fixed angle; charging sets how hard
const V_MIN = 8, V_MAX = 15.8;
const WIN = 5;
const BLOCK = { x: 0.75, y: 0.55, z: 1.05 }, COLS = 7, ROWS = 2;
const BALL_R = 0.17;

export default {
  id: 'snow',
  title: 'Snowball Fort',
  emoji: '⛄',
  blurb: 'A snowy morning. Lob snowballs over the walls, knock holes in their fort, and duck theirs. First to 5 hits.',
  controls: '<kbd>WASD</kbd> move · hold <kbd>Space</kbd> to wind up, let go to throw',
  touch: { buttons: [{ code: 'Space', label: 'Throw' }], hint: 'Hold <b>Throw</b> to wind up, let go to throw' },

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('winter');
    ctx.setSnow(1);
    ctx.setShadowArea(0, 0, 13);
    input.front = true; // seen from behind our fort: W runs towards theirs

    const forest = buildForest({ seed: 64, clearing: 13, trees: 120, deco: 1.2,
      keepOut: (x, z) => Math.abs(x) < 12.5 && Math.abs(z) < 7.5,
      // A few dry tufts poke through the snow; none on the trampled play area.
      surface: (x, z) => (Math.abs(x) < 11.5 && Math.abs(z) < 6.2 ? 'bare' : { h: 0.34, color: 0xcbbd8e, density: 0.07, wide: 0.7, thin: true }) });
    forest.name = 'forest';
    root.add(forest);

    // --- falling snow: a box of flakes around the play area, ---
    const FLAKES = 900, BOX = { x: 46, y: 16, z: 34 };
    const snow = glowPoints(FLAKES, { additive: false, fog: true });
    const rng = mulberry32(12);
    const flake = Array.from({ length: FLAKES }, () => ({ x: (rng() - 0.5) * BOX.x, y: rng() * BOX.y, z: (rng() - 0.5) * BOX.z, v: 0.9 + rng() * 1.1, ph: rng() * 30, s: 0.05 + rng() * 0.07 }));
    const sp = snow.geometry.attributes.position, ss = snow.geometry.attributes.aSize;
    flake.forEach((f, i) => ss.setX(i, f.s));
    root.add(snow);

    // --- forts ---------------------------------------------------------------
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xdbe6f6, roughness: 1, flatShading: true });
    const blockGeo = new THREE.BoxGeometry(BLOCK.x, BLOCK.y, BLOCK.z, 2, 2, 2);
    { // knock the corners about so the blocks look packed by paws, not cut by machine
      const p = blockGeo.attributes.position, r = mulberry32(3);
      const seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
        if (!seen.has(key)) seen.set(key, [(r() - 0.5) * 0.07, (r() - 0.5) * 0.07, (r() - 0.5) * 0.07]);
        const d = seen.get(key);
        p.setXYZ(i, p.getX(i) * (1 - 0.06) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
      }
      blockGeo.computeVertexNormals();
    }
    const blocks = [];
    for (const side of [-1, 1]) for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) {
      const m = new THREE.Mesh(blockGeo, snowMat);
      m.castShadow = m.receiveShadow = true;
      m.position.set(side * WALL_X, BLOCK.y * (row + 0.5), (col - (COLS - 1) / 2) * (BLOCK.z + 0.04));
      m.rotation.y = (Math.sin(col * 12.9 + row * 78.2 + side) * 0.5) * 0.12;
      root.add(m);
      blocks.push({ m, side, col, row, vy: 0 });
    }
    // Low snow banks behind each fort, and a snowman cheering each side on.
    for (const side of [-1, 1]) {
      const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), snowMat);
      pile.scale.set(1.3, 0.5, 5.6); pile.position.set(side * 11.6, 0, 0); pile.receiveShadow = true;
      root.add(ctx.own(pile));
      const man = new THREE.Group();
      [[0.55, 0.45], [0.4, 1.2], [0.28, 1.78]].forEach(([r, y]) => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), snowMat); b.position.y = y; b.castShadow = true; man.add(b); });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xf08a3c, roughness: 0.8 }));
      nose.rotation.z = side * Math.PI / 2; nose.position.set(-side * 0.38, 1.78, 0);
      const coal = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 1 });
      for (const z of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), coal); e.position.set(-side * 0.25, 1.87, z); man.add(e); }
      man.add(nose);
      man.position.set(side * 9.4, 0, side * -6.4);
      root.add(ctx.own(man));
    }

    // --- snowballs -----------------------------------------------------------
    const ballGeo = new THREE.IcosahedronGeometry(BALL_R, 2);
    const balls = [];
    function throwBall(p, vx, vy, vz) {
      let b = balls.find((x) => !x.live);
      if (!b) {
        b = { mesh: new THREE.Mesh(ballGeo, snowMat), shadow: makeBlobShadow(0.3), pos: new THREE.Vector3(), vel: new THREE.Vector3() };
        b.mesh.castShadow = true;
        root.add(b.mesh, ctx.own(b.shadow));
        balls.push(b);
      }
      b.live = true; b.owner = p;
      b.pos.set(p.c.position.x + p.dir * 0.3, p.c.position.y + p.c.height * 0.9, p.c.position.z);
      b.vel.set(vx, vy, vz);
      b.mesh.visible = b.shadow.visible = true;
      p.c.hop(2.2);
      sfx.kick();
    }
    const speedFor = (charge) => V_MIN + (V_MAX - V_MIN) * charge;
    /** Where a throw from height y0 comes down: [distance, time]. */
    function reach(speed, y0) {
      const vy = Math.sin(ANGLE) * speed, t = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
      return [Math.cos(ANGLE) * speed * t, t];
    }

    const dots = makeDots(10, 0xff7b6b, 0.09);
    const land = ctx.own(makeMarker(0xff7b6b));
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(dots, land, marker);

    const mk = (id, dir) => ({ c: ctx.spawn(id, { runSpeed: 3.6 }), dir, hits: 0, charge: -1, cool: 0, safe: 0, plan: 1.5, goal: 0, dodge: 0 });
    const P = mk(ctx.playerId, 1), Q = mk(ctx.rivalId, -1);
    const players = [P, Q];
    P.c.place(-7.5, 0, Math.PI / 2); Q.c.place(7.5, 0, -Math.PI / 2);
    Q.c.speedMul = 0.9;
    let time = 0;
    const v = new THREE.Vector3();
    hud.hint(this.controls);
    hud.banner('Snowball fight!', 1.4);

    function splat(pos, big) {
      ctx.burst(v.copy(pos), { count: big ? 22 : 10, colors: [0xffffff, 0xe3edfb], speed: big ? 3.5 : 2.2, up: big ? 4 : 2.5, life: 0.55, size: 0.09 });
    }

    function hitPlayer(p, b) {
      if (p.safe > 0) return;
      const by = b.owner;
      by.hits++;
      p.safe = 1.2; p.charge = -1;
      p.c.knock.x += Math.sign(b.vel.x) * 5; p.c.knock.z += b.vel.z * 0.3;
      p.c.hop(3.4);
      splat(b.pos, true);
      sfx.bump();
      (by === P ? sfx.point : sfx.lose)();
      hud.banner(by === P ? 'Splat! Got them' : 'Brr! You got hit', 1.1);
      if (by.hits >= WIN) {
        if (by === P) sfx.cheer();
        ctx.finish({ title: by === P ? 'You win!' : 'So close!', text: `${ctx.emoji(P.c.id)} ${P.hits} – ${Q.hits} ${ctx.emoji(Q.c.id)}`, won: by === P });
      }
    }

    function aiInput(p, dt) {
      const c = p.c, foe = (p === P ? Q : P).c;
      // Duck out of the way of a snowball that is coming down near us (most of the time).
      for (const b of balls) {
        if (!b.live || b.owner === p || b.seen) continue;
        const t = (b.vel.y + Math.sqrt(Math.max(0, b.vel.y * b.vel.y + 2 * G * b.pos.y))) / G;
        const lx = b.pos.x + b.vel.x * t, lz = b.pos.z + b.vel.z * t;
        if (t < 0.75) {
          b.seen = true;
          if (Math.hypot(lx - c.position.x, lz - c.position.z) < 1.3 && Math.random() < 0.62) {
            p.dodge = 0.55;
            p.goal = clamp(c.position.z + (lz > c.position.z ? -1 : 1) * 2.2, -HALF_Z, HALF_Z);
            if (Math.abs(p.goal - c.position.z) < 1) p.goal = clamp(c.position.z + (lz > c.position.z ? 1 : -1) * 2.2, -HALF_Z, HALF_Z);
          }
        }
      }
      p.dodge -= dt; p.plan -= dt;
      if (p.dodge <= 0) {
        // Line up with the player, wind up, and let fly with a bit of guesswork.
        if (p.plan < 0.9) p.goal = clamp(foe.position.z + foe.vz * 0.5, -HALF_Z, HALF_Z);
        if (p.plan <= 0 && Math.abs(c.position.z - p.goal) < 0.7 && c.grounded && p.cool <= 0) {
          const dist = Math.abs(foe.position.x + foe.vx * 0.6 - c.position.x) + (Math.random() - 0.5) * 2.6;
          let lo = 0, hi = 1;
          for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (reach(speedFor(mid), c.height * 0.9)[0] < dist) lo = mid; else hi = mid; }
          const s = speedFor(lo), dz = (foe.position.z + foe.vz * 0.7 - c.position.z) / reach(s, c.height * 0.9)[1];
          throwBall(p, p.dir * Math.cos(ANGLE) * s, Math.sin(ANGLE) * s, clamp(dz, -2.5, 2.5));
          p.cool = 0.5;
          p.plan = 1.3 + Math.random() * 1.5;
          p.goal = clamp(c.position.z + (Math.random() - 0.5) * 6, -HALF_Z, HALF_Z);
          p.gx = ZONE[0] + 0.6 + Math.random() * (ZONE[1] - ZONE[0] - 1.2);
        }
      }
      return toward(c, -p.dir * (p.gx ?? 7.5), p.goal, { stop: 0.25, slow: 0.8 });
    }

    return {
      get state() { return { a: P.hits, b: Q.hits, blocks: blocks.filter((b) => !b.gone).length, charge: P.charge }; },

      update(dt) {
        time += dt;
        const live = time > 1.2 && !ctx.over;

        for (const p of players) {
          const c = p.c;
          p.cool -= dt; p.safe -= dt;
          let inp = null;
          if (live) {
            if (p === P && !ctx.auto) {
              const m = input.move();
              inp = m.x || m.z ? { x: m.x, z: m.z, run: p.charge < 0 } : null; // winding up slows you to a walk
              if (input.down('Space') && p.charge < 0 && p.cool <= 0 && p.safe <= 0.6) p.charge = 0;
              if (p.charge >= 0) {
                p.charge = Math.min(1, p.charge + dt / 0.95);
                if (!input.down('Space')) {
                  const s = speedFor(p.charge);
                  throwBall(p, Math.cos(ANGLE) * s, Math.sin(ANGLE) * s, c.vz * 0.35);
                  p.charge = -1; p.cool = 0.4;
                }
              }
            } else inp = aiInput(p, dt);
          } else if (ctx.over && p.hits >= WIN && c.grounded && Math.random() < dt * 2) c.hop(4);
          c.update(dt, inp);
          // Stay inside your own fort.
          const ax = clamp(Math.abs(c.position.x), ZONE[0], ZONE[1]);
          c.position.x = -p.dir * ax;
          c.position.z = clamp(c.position.z, -HALF_Z, HALF_Z);
          if (!inp && c.grounded) c.faceYaw(p.dir * Math.PI / 2, dt, 7);
          c.root.visible = p.safe <= 0 || Math.floor(p.safe * 12) % 2 === 0; // blink while safe
        }

        for (const b of balls) {
          if (!b.live) continue;
          b.vel.y -= G * dt;
          b.pos.addScaledVector(b.vel, dt);
          b.mesh.position.copy(b.pos);
          b.mesh.rotation.x += dt * 6;
          b.shadow.position.set(b.pos.x, 0.035, b.pos.z);
          let done = b.pos.y < BALL_R;
          // Their wall stops it (your own you throw over).
          for (const k of blocks) {
            if (k.gone || k.side === -b.owner.dir) continue;
            const q = k.m.position;
            if (Math.abs(b.pos.x - q.x) < BLOCK.x / 2 + BALL_R && Math.abs(b.pos.y - q.y) < BLOCK.y / 2 + BALL_R && Math.abs(b.pos.z - q.z) < BLOCK.z / 2 + BALL_R) {
              k.gone = true; k.m.visible = false;
              splat(q, true);
              sfx.pop();
              done = true;
              break;
            }
          }
          const foe = b.owner === P ? Q : P, c = foe.c, y = b.pos.y - c.position.y;
          if (!done && !ctx.over && Math.hypot(b.pos.x - c.position.x, b.pos.z - c.position.z) < c.radius + BALL_R + 0.1 && y > -0.1 && y < c.height + 0.1) {
            hitPlayer(foe, b);
            done = true;
          } else if (done && b.pos.y < BALL_R) { b.pos.y = 0.1; splat(b.pos, false); if (b.owner === P || Math.abs(b.pos.x - P.c.position.x) < 4) sfx.pop(); }
          if (done) { b.live = false; b.seen = false; b.mesh.visible = b.shadow.visible = false; }
        }

        // Blocks drop when the one beneath is knocked out.
        for (const k of blocks) {
          if (k.gone) continue;
          const below = blocks.filter((o) => !o.gone && o.side === k.side && o.col === k.col && o.row < k.row).length;
          const rest = BLOCK.y * (below + 0.5);
          if (k.m.position.y > rest) { k.vy -= G * dt; k.m.position.y = Math.max(rest, k.m.position.y + k.vy * dt); } else k.vy = 0;
        }

        // Wind-up: show where the snowball will come down.
        if (P.charge >= 0) {
          const c = P.c, s = speedFor(P.charge), y0 = c.height * 0.9, [d, t] = reach(s, y0), pts = [];
          const vz = c.vz * 0.35;
          for (let i = 1; i <= 10; i++) { const u = (i / 10.5) * t; pts.push([c.position.x + 0.3 + Math.cos(ANGLE) * s * u, y0 + Math.sin(ANGLE) * s * u - 0.5 * G * u * u, c.position.z + vz * u]); }
          dots.show(pts);
          land.visible = true;
          land.position.set(c.position.x + 0.3 + d, 0.05, c.position.z + vz * t);
          land.scale.setScalar(0.42 + 0.08 * Math.sin(time * 14));
        } else { dots.show([]); land.visible = false; }

        for (let i = 0; i < FLAKES; i++) {
          const f = flake[i];
          f.y -= f.v * dt; if (f.y < 0) f.y += BOX.y;
          sp.setXYZ(i, f.x + Math.sin(time * 0.8 + f.ph) * 0.5, f.y, f.z + Math.cos(time * 0.6 + f.ph) * 0.4);
        }
        sp.needsUpdate = true;
        snow.sync(ctx);

        marker.position.set(P.c.position.x, 0.04, P.c.position.z);
        marker.scale.setScalar(P.c.radius * 1.5);
        marker.visible = !ctx.over;
        const back = Math.max(9.5, 14 / ctx.camera.aspect);
        ctx.cam(P.c.position.x - back, 8.2, P.c.position.z * 0.7, 2.5, 0.2, P.c.position.z * 0.45);
        hud.set({
          left: chip(ctx.emoji(P.c.id), P.hits, ctx.colorOf(P.c.id)),
          right: chip(ctx.emoji(Q.c.id), Q.hits, ctx.colorOf(Q.c.id)),
          center: `First to ${WIN}`,
        });
      },

      dispose() { snow.dispose(); blockGeo.dispose(); ballGeo.dispose(); snowMat.dispose(); for (const p of players) p.c.root.visible = true; },
    };
  },
};
