import * as THREE from 'three';
import { buildForest, plushMaterial, canvasTexture, makeMarker, Scatter, mulberry32, PALETTE } from '../forest.js';
import { separateCharacters } from '../physics.js';
import { chip } from './common.js';

const R = 3.5;        // cushion radius
const DROP = 2.2;     // how far down the forest floor is
const WIN = 3;

export default {
  id: 'sumo',
  title: 'Pillow Sumo',
  emoji: '🛋️',
  blurb: 'Bump your friend off the giant cushion. Pounce for a bigger shove. First to 3.',
  controls: '<kbd>WASD</kbd> move · <kbd>Space</kbd> pounce',

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('golden');
    ctx.setShadowArea(0, 0, 9);

    const forest = buildForest({ seed: 33, clearing: 12, keepOut: (x, z) => Math.hypot(x, z) < R + 3.6, trees: 80 });
    forest.name = 'forest';
    forest.position.y = -DROP;
    root.add(forest);

    // Tree stump with a big round cushion on top.
    const stage = new THREE.Group();
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.25, R + 0.7, DROP - 0.4, 14),
      new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 1, flatShading: true }));
    stump.position.y = -0.4 - (DROP - 0.4) / 2;
    const stumpTop = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.06, 14),
      new THREE.MeshStandardMaterial({ color: PALETTE.woodLight, roughness: 1, flatShading: true }));
    stumpTop.position.y = -0.4;
    const cushionTex = canvasTexture(512, 512, (g) => {
      g.fillStyle = '#f2a0a8'; g.fillRect(0, 0, 512, 512);
      const rings = ['#f7c9c2', '#f2a0a8', '#f7c9c2', '#ee8f9b'];
      rings.forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(256, 256, 250 - i * 62, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = '#fff7ef'; g.beginPath(); g.arc(256, 256, 14, 0, Math.PI * 2); g.fill();
    });
    const profile = [[0, -0.4], [R - 0.1, -0.36], [R, -0.2], [R - 0.12, -0.06], [R - 0.45, 0], [0, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const cushionGeo = new THREE.LatheGeometry(profile, 40);
    // Planar UVs from above so the rings sit on the top face.
    const pos = cushionGeo.attributes.position, uv = cushionGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (R * 2.04), 0.5 + pos.getZ(i) / (R * 2.04));
    const cushion = new THREE.Mesh(cushionGeo, plushMaterial(0xffffff, { map: cushionTex }));
    stump.castShadow = stump.receiveShadow = cushion.castShadow = cushion.receiveShadow = stumpTop.receiveShadow = true;
    stage.add(stump, stumpTop, cushion);
    root.add(ctx.own(stage));

    // A soft pile of autumn leaves to land in.
    const rng = mulberry32(5), leaves = new Scatter();
    for (let i = 0; i < 150; i++) {
      const a = rng() * Math.PI * 2, r = R + 0.9 + rng() * 2.4, s = 0.25 + rng() * 0.3;
      leaves.add('blob', [Math.cos(a) * r, -DROP + s * 0.3, Math.sin(a) * r], [s, s * 0.45, s],
        [0xe9a23b, 0xd9742e, 0xf2c84b, 0xc95f3a][i % 4], { rotY: rng() * 6, shadow: false });
    }
    root.add(leaves.build());

    const mk = (id, x) => ({ c: ctx.spawn(id, { runSpeed: 3.0, knockDrag: 4 }), x0: x, wins: 0, dashCd: 0, out: false, wobble: Math.random() * 6 });
    const P = mk(ctx.playerId, -1.7), Q = mk(ctx.rivalId, 1.7);
    const players = [P, Q];
    const chars = [P.c, Q.c];
    Q.c.speedMul = 0.88;
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    let phase = 'ready', phaseT = 1.3, round = 1, bumpCd = 0, time = 0;
    const v = new THREE.Vector3();

    function resetRound() {
      for (const p of players) {
        p.out = false; p.dashCd = 0.4;
        p.c.floorY = 0;
        p.c.root.position.y = 0;
        p.c.place(p.x0, 0, p.x0 < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      phase = 'ready'; phaseT = 1.2;
      hud.banner(`Round ${round}`, 1.1);
      sfx.blip();
    }
    resetRound();
    hud.hint(this.controls);

    function dash(p) {
      if (p.dashCd > 0 || !p.c.grounded) return;
      const f = p.c.facing(v);
      p.c.knock.x += f.x * 7.5; p.c.knock.z += f.z * 7.5;
      p.c.hop(2.6);
      p.dashCd = p === P && !ctx.auto ? 1.2 : 1.7 + Math.random() * 1.2;
      sfx.boing();
    }

    function aiInput(p, opp) {
      const c = p.c, o = opp.c;
      const dx = o.position.x - c.position.x, dz = o.position.z - c.position.z, d = Math.hypot(dx, dz) || 1;
      const myR = Math.hypot(c.position.x, c.position.z) || 0.001, oppR = Math.hypot(o.position.x, o.position.z);
      const pull = Math.pow(myR / R, 3) * 1.7;       // stay away from the edge
      const wob = Math.sin(time * 1.3 + p.wobble) * 0.4; // circle a little
      let x = dx / d - (c.position.x / myR) * pull + (-dz / d) * wob;
      let z = dz / d - (c.position.z / myR) * pull + (dx / d) * wob;
      const l = Math.hypot(x, z) || 1;
      const f = c.facing(v);
      if (d < 2.3 && (f.x * dx + f.z * dz) / d > 0.8 && oppR > myR - 0.6) dash(p);
      return { x: x / l, z: z / l, run: true };
    }

    function contact(a, b, nx, nz) {
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing < 0.3) return;
      // Whoever is moving into the other harder wins the shove.
      const aIn = a.vx * nx + a.vz * nz, bIn = -(b.vx * nx + b.vz * nz);
      const [hit, giver, s] = aIn >= bIn ? [b, a, 1] : [a, b, -1];
      hit.knock.x += nx * s * closing * 0.95; hit.knock.z += nz * s * closing * 0.95;
      giver.knock.x -= nx * s * closing * 0.45; giver.knock.z -= nz * s * closing * 0.45;
      if (closing > 4 && bumpCd <= 0) {
        bumpCd = 0.25;
        sfx.bump();
        ctx.burst(v.set((a.position.x + b.position.x) / 2, 0.8, (a.position.z + b.position.z) / 2),
          { count: 10, colors: [0xffffff, 0xffe9a8], speed: 3, up: 3, life: 0.5, size: 0.09 });
      }
    }

    return {
      get state() { return { a: P.wins, b: Q.wins, phase, round }; },

      update(dt) {
        time += dt; phaseT -= dt; bumpCd -= dt;
        if (phase === 'ready' && phaseT <= 0) phase = 'fight';
        if (phase === 'out' && phaseT <= 0 && !ctx.over) { round++; resetRound(); }

        for (const p of players) {
          const opp = p === P ? Q : P, c = p.c;
          p.dashCd -= dt;
          let inp = null;
          if (phase === 'fight' && !p.out) {
            if (p === P && !ctx.auto) {
              const m = input.move();
              if (input.hit('Space')) dash(p);
              inp = m.x || m.z ? { x: m.x, z: m.z, run: true } : null;
            } else inp = aiInput(p, opp);
          } else if (phase === 'out' && !p.out && c.grounded && Math.random() < dt * 2) c.hop(4);
          c.update(dt, inp);
          if (!inp && c.grounded && !p.out) c.facePoint(opp.c.position.x, opp.c.position.z, dt, 6);
        }
        separateCharacters(chars, contact);

        for (const p of players) {
          const c = p.c, d = Math.hypot(c.position.x, c.position.z);
          if (!p.out && d > R + 0.05) {
            p.out = true;
            c.floorY = -DROP;
            c.knock.x += (c.position.x / d) * 1.5; c.knock.z += (c.position.z / d) * 1.5;
          }
          if (p.out && d < R + c.radius && c.position.y < -0.1) { // don't sink into the stump
            c.position.x *= (R + c.radius) / d; c.position.z *= (R + c.radius) / d;
          }
          if (p.out && phase === 'fight' && c.position.y < -1.1) {
            const winner = p === P ? Q : P;
            winner.wins++;
            phase = 'out'; phaseT = 1.9;
            ctx.burst(v.set(c.position.x, -DROP + 0.3, c.position.z), { count: 30, colors: [0xe9a23b, 0xd9742e, 0xf2c84b], speed: 4, up: 5, size: 0.16 });
            (winner === P ? sfx.point : sfx.lose)();
            hud.banner(winner === P ? 'Bonk! Your round' : `${ctx.nameOf(Q.c.id)} takes it`, 1.6);
            if (winner.wins >= WIN) {
              if (winner === P) sfx.cheer();
              ctx.finish({
                title: winner === P ? 'You win!' : 'So close!',
                text: `${ctx.emoji(P.c.id)} ${P.wins} – ${Q.wins} ${ctx.emoji(Q.c.id)}`, won: winner === P,
              });
            }
          }
        }

        marker.position.set(P.c.position.x, 0.04, P.c.position.z);
        marker.scale.setScalar(P.c.radius * 1.5);
        marker.material.opacity = P.dashCd <= 0 ? 0.9 : 0.3; // bright ring = pounce ready
        marker.visible = !P.out && !ctx.over;

        const far = Math.max(9.6, 16 / ctx.camera.aspect);
        ctx.cam(0, 6.6, far, 0, -0.1, 0);
        hud.set({
          left: chip(ctx.emoji(P.c.id), P.wins, ctx.colorOf(P.c.id)),
          right: chip(ctx.emoji(Q.c.id), Q.wins, ctx.colorOf(Q.c.id)),
          center: `Round ${round}`,
        });
      },
    };
  },
};
