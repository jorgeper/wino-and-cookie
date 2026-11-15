import * as THREE from 'three';
import { buildForest, makeLog, canvasTexture, groundDecal, makeMarker, PALETTE } from '../forest.js';
import { separateCharacters, collideSegments } from '../physics.js';
import { toward, fmtTime } from './common.js';

const M = 11;                         // meadow radius
const PEN = { x0: -3, x1: 3, z0: -10, z1: -5, gate: 1.4 }; // gate is the gap in the front (z1) side
const BABIES = 8;
const TIME = 130;

export default {
  id: 'herd',
  title: 'Herd the Babies',
  emoji: '🐣',
  blurb: 'The little ones scamper away from you. Nudge them all into the pen before sunset.',
  controls: '<kbd>WASD</kbd> move · <kbd>Space</kbd> hop · babies run <i>away</i> from you, so get behind them',
  touch: { buttons: [{ code: 'Space', label: 'Hop' }], hint: 'Babies run <i>away</i> from you, so get behind them' },

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('day');
    ctx.setShadowArea(0, -1, 14);

    const inPenArea = (x, z, pad = 0) => x > PEN.x0 - pad && x < PEN.x1 + pad && z > PEN.z0 - pad && z < PEN.z1 + pad;
    const forest = buildForest({ seed: 52, clearing: M + 3, keepOut: (x, z) => inPenArea(x, z, 0.4),
      view: (x, z) => Math.hypot(x, z) < M || inPenArea(x, z, 0.4), // the whole meadow is the game, not just the pen
      solidOut: (x, z) => Math.hypot(x, z) < M + 1, deco: 1.5,
      // Straw in the pen; the meadow is grazed short so the little ones stay visible.
      surface: (x, z) => (inPenArea(x, z, 0.3) ? 'bare' : Math.hypot(x, z) < M ? { h: 0.1, density: 0.75, wide: 1 } : undefined) });
    forest.name = 'forest';
    root.add(forest);

    // Pen: straw floor, log fence, a gate gap facing the meadow.
    const strawTex = canvasTexture(256, 256, (g) => {
      g.beginPath(); g.roundRect(4, 4, 248, 248, 24); g.clip();
      g.fillStyle = '#ecd28e'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(190,150,70,0.55)'; g.lineWidth = 2;
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * 256, y = Math.random() * 256, a = Math.random() * Math.PI;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.stroke();
      }
    });
    const straw = groundDecal(PEN.x1 - PEN.x0 + 0.5, PEN.z1 - PEN.z0 + 0.5, strawTex);
    straw.position.set((PEN.x0 + PEN.x1) / 2, 0.02, (PEN.z0 + PEN.z1) / 2);
    root.add(ctx.own(straw));

    const fence = [
      { ax: PEN.x0, az: PEN.z0, bx: PEN.x1, bz: PEN.z0 },
      { ax: PEN.x0, az: PEN.z0, bx: PEN.x0, bz: PEN.z1 },
      { ax: PEN.x1, az: PEN.z0, bx: PEN.x1, bz: PEN.z1 },
      { ax: PEN.x0, az: PEN.z1, bx: -PEN.gate, bz: PEN.z1 },
      { ax: PEN.gate, az: PEN.z1, bx: PEN.x1, bz: PEN.z1 },
    ];
    const gateSeg = { ax: -PEN.gate, az: PEN.z1, bx: PEN.gate, bz: PEN.z1 };
    const props = new THREE.Group();
    for (const s of fence) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az), n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) {
        const x = s.ax + ((s.bx - s.ax) * i) / n, z = s.az + ((s.bz - s.az) * i) / n;
        props.add(makeLog([x, 0, z], [x, 0.85, z], 0.085, PALETTE.wood));
      }
      for (const y of [0.32, 0.66]) props.add(makeLog([s.ax, y, s.az], [s.bx, y, s.bz], 0.05, PALETTE.woodLight));
    }
    // Gate posts with a string of bunting, so the way in is obvious.
    for (const x of [-PEN.gate, PEN.gate]) props.add(makeLog([x, 0, PEN.z1], [x, 1.9, PEN.z1], 0.1, PALETTE.woodDark));
    props.add(makeLog([-PEN.gate, 1.85, PEN.z1], [PEN.gate, 1.85, PEN.z1], 0.03, 0xfffaf0));
    const flagGeo = new THREE.ConeGeometry(0.14, 0.26, 3);
    [0xff7b6b, 0xffd84d, 0x7cc4f5, 0xb79bff, 0xff9ebd, 0x8fd18a].forEach((col, i, arr) => {
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, flatShading: true }));
      flag.position.set(-PEN.gate + ((i + 0.5) * PEN.gate * 2) / arr.length, 1.68, PEN.z1);
      flag.rotation.x = Math.PI;
      flag.scale.z = 0.25;
      props.add(flag);
    });
    root.add(ctx.own(props));

    const player = ctx.spawn(ctx.playerId, { runSpeed: 3.7 });
    player.place(0, 4, Math.PI);
    const helper = ctx.spawn(ctx.rivalId);
    helper.place(PEN.x1 + 1.1, PEN.z1 + 0.9, 0);
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    const babies = [];
    for (let i = 0; i < BABIES; i++) {
      const id = i % 2 ? ctx.WINO : ctx.COOKIE;
      const c = ctx.spawn(id, { scale: id === ctx.WINO ? 0.62 : 0.52, walkSpeed: 0.9, runSpeed: 2.5, turnSpeed: 9 });
      const a = (i / BABIES) * Math.PI * 2 + 0.4, r = 3 + Math.random() * 5;
      c.place(Math.cos(a) * r, Math.sin(a) * r * 0.7 + 2.5, Math.random() * 6);
      babies.push({ c, home: false, t: Math.random() * 2, dir: null, panic: 0 });
    }
    const everyone = [player, helper, ...babies.map((b) => b.c)];

    let timeLeft = TIME, homeCount = 0, moodT = 0, autoT = 0;
    const v = new THREE.Vector3();
    hud.hint(this.controls);
    hud.banner('Bedtime soon!', 1.5);

    function babyInput(b, dt) {
      const c = b.c, p = c.position;
      b.t -= dt;
      if (b.home) { // potter about inside the pen
        if (b.t <= 0) {
          b.t = 1.5 + Math.random() * 3;
          b.dir = Math.random() < 0.5 ? null : { x: PEN.x0 + 0.8 + Math.random() * (PEN.x1 - PEN.x0 - 1.6), z: PEN.z0 + 0.8 + Math.random() * (PEN.z1 - PEN.z0 - 1.6) };
        }
        return b.dir ? toward(c, b.dir.x, b.dir.z, { stop: 0.3, run: false }) : null;
      }
      const dx = p.x - player.position.x, dz = p.z - player.position.z, d = Math.hypot(dx, dz) || 1;
      let x = 0, z = 0, run = false;
      if (d < 4.2) {
        b.panic = 0.5;
        x = dx / d; z = dz / d; run = d < 3.2;
        // Home is inviting: close to the gate they drift towards it.
        const gx = -p.x, gz = PEN.z1 - 0.8 - p.z, gd = Math.hypot(gx, gz);
        if (gd < 4 && p.z > PEN.z1 - 0.3) { x += (gx / gd) * 0.7; z += (gz / gd) * 0.7; }
        b.t = 0.6; b.dir = null;
      } else if ((b.panic -= dt) > 0) {
        return b.last;
      } else {
        if (b.t <= 0) {
          b.t = 2 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          b.dir = Math.random() < 0.45 ? null : { x: Math.cos(a), z: Math.sin(a) };
        }
        if (!b.dir) return (b.last = null);
        x = b.dir.x; z = b.dir.z;
      }
      // Stay in the meadow.
      const r = Math.hypot(p.x, p.z);
      if (r > M - 2.5) { const w = ((r - (M - 2.5)) / 2.5) * 2; x -= (p.x / r) * w; z -= (p.z / r) * w; }
      const l = Math.hypot(x, z) || 1;
      return (b.last = { x: x / l, z: z / l, run });
    }

    /** Self-playing shepherd (used for the attract/auto mode): stand behind a baby, opposite the gate. */
    function autoInput(dt) {
      autoT -= dt;
      const left = babies.filter((b) => !b.home);
      if (!left.length) return null;
      const gate = { x: 0, z: PEN.z1 + 0.6 };
      left.sort((a, b) => Math.hypot(a.c.position.x - gate.x, a.c.position.z - gate.z) - Math.hypot(b.c.position.x - gate.x, b.c.position.z - gate.z));
      const t = left[0].c.position;
      const ax = t.x - gate.x, az = t.z - gate.z, al = Math.hypot(ax, az) || 1;
      return toward(player, t.x + (ax / al) * 2.4, t.z + (az / al) * 2.4, { stop: 0.3 });
    }

    function finish() {
      const all = homeCount === BABIES;
      if (all) sfx.cheer(); else sfx.whistle();
      ctx.finish({
        title: all ? 'All tucked in!' : 'Bedtime!',
        text: all ? `Everyone home with ${fmtTime(timeLeft)} to spare` : `${homeCount} of ${BABIES} little ones made it home`,
        won: all,
      });
    }

    return {
      get state() { return { home: homeCount, timeLeft }; },

      update(dt) {
        if (!ctx.over) timeLeft -= dt;
        if ((moodT -= dt) <= 0) { // the sun goes down as time runs out
          moodT = 0.4;
          const t = THREE.MathUtils.smoothstep(1 - timeLeft / TIME, 0.25, 1);
          ctx.setMood('day', 'dusk', t);
        }

        let inp = null;
        if (!ctx.over) {
          if (ctx.auto) inp = autoInput(dt);
          else {
            const m = input.move();
            if (input.hit('Space')) player.jump();
            inp = m.x || m.z ? { x: m.x, z: m.z, run: true } : null;
          }
        }
        player.update(dt, inp);

        for (const b of babies) b.c.update(dt, ctx.over && !b.home ? null : babyInput(b, dt));

        // The helper waits by the gate and watches the nearest stray.
        let near = null, nd = 1e9;
        for (const b of babies) if (!b.home) { const d = b.c.position.distanceTo(helper.position); if (d < nd) { nd = d; near = b; } }
        helper.update(dt, null);
        if (helper.grounded) { const t = near ? near.c.position : player.position; helper.facePoint(t.x, t.z, dt, 4); }
        if (ctx.over && homeCount === BABIES && helper.grounded && Math.random() < dt) helper.hop(4);

        separateCharacters(everyone);
        const rP = Math.hypot(player.position.x, player.position.z);
        if (rP > M) { player.position.x *= M / rP; player.position.z *= M / rP; }
        collideSegments(player.position, player.radius, fence);
        collideSegments(helper.position, helper.radius, fence);
        for (const b of babies) {
          const p = b.c.position, r = Math.hypot(p.x, p.z);
          if (r > M) { p.x *= M / r; p.z *= M / r; }
          collideSegments(p, b.c.radius, fence);
          if (b.home) collideSegments(p, b.c.radius, [gateSeg]);
          else if (inPenArea(p.x, p.z, -0.15) && p.z < PEN.z1 - b.c.radius - 0.15) {
            b.home = true; b.t = 0.8; b.dir = null;
            homeCount++;
            b.c.hop(3.5);
            helper.hop(3.5);
            sfx.point();
            ctx.burst(v.set(p.x, 0.6, p.z), { count: 12, colors: [0xff9ebd, 0xffd84d, 0xffffff], speed: 2, up: 4, life: 0.9, size: 0.1 });
            hud.banner(homeCount === BABIES ? 'Everyone is home!' : `${homeCount} home`, 1);
          }
        }

        marker.position.set(player.position.x, 0.04, player.position.z);
        marker.scale.setScalar(player.radius * 1.5);
        marker.visible = !ctx.over;

        const px = player.position.x, pz = player.position.z;
        ctx.cam(px * 0.5, 10.5, pz * 0.45 + 12.5, px * 0.5, 0, pz * 0.45 - 2.2);
        hud.set({ left: `🏡 <b>${homeCount}</b> / ${BABIES}`, center: `🌇 ${fmtTime(timeLeft)}`, right: null });

        if (!ctx.over && (homeCount === BABIES || timeLeft <= 0)) finish();
      },
    };
  },
};
