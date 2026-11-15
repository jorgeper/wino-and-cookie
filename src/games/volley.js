import * as THREE from 'three';
import { buildForest, makeLog, canvasTexture, groundDecal, makeBlobShadow, makeMarker, PALETTE } from '../forest.js';
import { ballVsCharacter } from '../physics.js';
import { toward, clamp, chip } from './common.js';

const CL = 6, CD = 3;       // court half length (x) and half depth (z)
const NET = 1.55;           // net height
const R = 0.42;             // balloon radius
const G = 5.5, K = 1.0;     // balloon gravity and air drag: slow and floaty
const WIN = 5;

export default {
  id: 'volley',
  title: 'Balloon Volleyball',
  emoji: '🎈',
  blurb: 'Keep the balloon off your side of the net. Jump into it for a spike. First to 5.',
  controls: '<kbd>WASD</kbd> move · <kbd>Space</kbd> jump (spike) · watch the balloon\'s shadow',
  touch: { buttons: [{ code: 'Space', label: 'Jump' }], hint: 'Jump into the balloon for a spike · watch its shadow' },

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('golden');
    ctx.setShadowArea(0, 0, 10);

    const forest = buildForest({ seed: 21, clearing: 13, keepOut: (x, z) => Math.abs(x) < CL + 2 && Math.abs(z) < CD + 2,
      surface: (x, z) => (Math.abs(x) < CL + 0.85 && Math.abs(z) < CD + 0.85 ? 'bare' : undefined) }); // sand court
    forest.name = 'forest';
    root.add(forest);

    const PX = 48;
    const tex = canvasTexture((CL * 2 + 1.6) * PX, (CD * 2 + 1.6) * PX, (g, w, h) => {
      const m = 0.8 * PX;
      g.beginPath(); g.roundRect(0, 0, w, h, PX); g.clip();
      g.fillStyle = '#f1dcae'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(214,186,130,0.5)';
      for (let i = 0; i < 500; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(m, m, w / 2 - m, h - 2 * m);
      g.strokeStyle = '#ffffff'; g.lineWidth = 6;
      g.strokeRect(m, m, w - 2 * m, h - 2 * m);
      g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
    });
    root.add(ctx.own(groundDecal(CL * 2 + 1.6, CD * 2 + 1.6, tex)));

    // Net
    const props = new THREE.Group();
    for (const z of [-CD - 0.5, CD + 0.5]) props.add(makeLog([0, 0, z], [0, NET + 0.25, z], 0.1, PALETTE.woodLight));
    // A thick tape along the top: the camera looks along the net, so it needs some width to read.
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, CD * 2 + 1), new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.9 }));
    tape.position.set(0, NET - 0.08, 0);
    tape.castShadow = true;
    props.add(tape);
    const mesh3d = new THREE.Mesh(new THREE.BoxGeometry(0.035, NET - 0.7, CD * 2 + 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.45 }));
    mesh3d.position.set(0, (NET + 0.55) / 2 - 0.08, 0);
    props.add(mesh3d);
    const netTex = canvasTexture(256, 64, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
      for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); }
      for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    });
    const netMesh = new THREE.Mesh(new THREE.PlaneGeometry(CD * 2 + 1, NET - 0.55),
      new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    netMesh.rotation.y = Math.PI / 2;
    netMesh.position.set(0, (NET + 0.55) / 2, 0);
    props.add(netMesh);
    root.add(ctx.own(props));

    // Balloon
    const balloon = new THREE.Group();
    const skin = new THREE.MeshPhysicalMaterial({ color: 0xff6f61, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), skin);
    body.scale.y = 1.12; body.castShadow = true;
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 8), skin);
    knot.position.y = -R * 1.12 - 0.03;
    balloon.add(body, knot);
    root.add(ctx.own(balloon));
    const blob = ctx.own(makeBlobShadow(0.6));
    root.add(blob);
    const ball = { pos: balloon.position, vel: new THREE.Vector3(), radius: R };

    // Players: side -1 is the left (human), +1 the right.
    const mk = (id, side) => {
      const c = ctx.spawn(id, { runSpeed: 3.6 });
      return { c, side, score: 0, touchCd: 0, err: { x: 0, z: 0 }, wantsBall: false, jumpCd: 0 };
    };
    const P = mk(ctx.playerId, -1), Q = mk(ctx.rivalId, 1);
    const players = [P, Q];
    Q.c.speedMul = 0.86;
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    let phase = 'serve', phaseT = 1.2, squash = 0, hits = 0;
    const v = new THREE.Vector3();

    function serve(side) {
      phase = 'serve'; phaseT = 1.1;
      ball.pos.set(side * 3, 4.4, 0);
      ball.vel.set(0, 0, 0);
      balloon.visible = true;
      balloon.scale.setScalar(0.01);
    }
    function resetPlayers() {
      for (const p of players) p.c.place(p.side * 3, 0, p.side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    resetPlayers();
    serve(-1);
    hud.hint(this.controls);
    hud.banner(`First to ${WIN}`, 1.4);

    /** Where the balloon will come down to head height. */
    function predict(out) {
      let x = ball.pos.x, y = ball.pos.y, z = ball.pos.z, vx = ball.vel.x, vy = ball.vel.y, vz = ball.vel.z;
      const h = 0.05, d = Math.exp(-K * h);
      for (let t = 0; t < 5 && !(y < 1.5 && vy < 0); t += h) {
        vy -= G * h; vx *= d; vy *= d; vz *= d;
        x += vx * h; y += vy * h; z += vz * h;
      }
      out.x = x; out.z = z;
      return out;
    }

    const land = { x: 0, z: 0 };
    function aiInput(p, dt, skill) {
      const c = p.c, s = p.side;
      predict(land);
      const mine = land.x * s > 0.1 && phase !== 'point';
      if (mine && !p.wantsBall) { // new incoming balloon: commit to a slightly wrong guess
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (1 - skill) * 2.6;
        p.err.x = Math.cos(a) * r; p.err.z = Math.sin(a) * r;
      }
      p.wantsBall = mine;
      p.jumpCd -= dt;
      if (!mine) return toward(c, s * 3.2, 0, { stop: 0.3 });
      const dx = ball.pos.x - c.position.x, dz = ball.pos.z - c.position.z;
      const above = ball.pos.y - c.height;
      if (Math.hypot(dx, dz) < 0.75 && above > 0.9 && above < 1.7 && ball.vel.y < 0 && p.jumpCd <= 0) {
        p.jumpCd = 1.5;
        if (Math.random() < 0.6) c.jump();
      }
      return toward(c, clamp(land.x + p.err.x, -CL, CL) + s * 0.1, land.z + p.err.z, { stop: 0.12, slow: 0.6 });
    }

    function point(winner) {
      winner.score++;
      phase = 'point'; phaseT = 1.5;
      balloon.visible = false;
      sfx.pop();
      (winner === P ? sfx.point : sfx.lose)();
      ctx.burst(v.copy(ball.pos), { count: 26, colors: [0xff6f61, 0xffb3a8, 0xffffff], speed: 4, up: 4 });
      hud.banner(winner === P ? 'Point!' : `${ctx.nameOf(Q.c.id)} scores`, 1.2);
      if (winner.score >= WIN) {
        if (winner === P) sfx.cheer();
        ctx.finish({
          title: winner === P ? 'You win!' : 'So close!',
          text: `${ctx.emoji(P.c.id)} ${P.score} – ${Q.score} ${ctx.emoji(Q.c.id)}`, won: winner === P,
        });
      }
    }

    return {
      get state() { return { a: P.score, b: Q.score, phase, hits }; },

      update(dt) {
        phaseT -= dt;
        if (phase === 'point' && phaseT <= 0 && !ctx.over) serve(ball.pos.x < 0 ? -1 : 1);
        if (phase === 'serve') {
          balloon.scale.setScalar(Math.min(1, balloon.scale.x + dt * 3));
          if (phaseT <= 0) phase = 'play';
        }

        // Characters
        for (const p of players) {
          p.touchCd -= dt;
          const c = p.c;
          let inp = null;
          if (!ctx.over) {
            if (p === P && !ctx.auto) {
              const m = input.move();
              if (input.hit('Space')) c.jump();
              inp = m.x || m.z ? { x: m.x, z: m.z, run: true } : null;
            } else inp = aiInput(p, dt, p === P ? 0.8 : 0.66);
          } else if (c.grounded && Math.random() < dt && p.score >= WIN) c.hop(4);
          c.update(dt, inp);
          if (!inp && c.grounded) c.facePoint(ball.pos.x, ball.pos.z, dt, 5);
          const edge = c.radius + 0.12;
          c.position.x = p.side < 0 ? clamp(c.position.x, -CL, -edge) : clamp(c.position.x, edge, CL);
          c.position.z = clamp(c.position.z, -CD, CD);
        }

        // Balloon
        if (phase === 'play') {
          const before = Math.sign(ball.pos.x) || 1;
          const d = Math.exp(-K * dt);
          ball.vel.y -= G * dt;
          ball.vel.multiplyScalar(d);
          ball.pos.addScaledVector(ball.vel, dt);

          for (const p of players) {
            const n = ballVsCharacter(ball, p.c);
            if (!n || p.touchCd > 0) continue;
            const c = p.c, air = !c.grounded;
            p.touchCd = 0.3;
            ball.vel.set(
              -p.side * (2.4 + Math.abs(c.position.x) * 1.0 + (air ? 1.3 : 0)) + c.vx * 0.3,
              air ? 5.2 : 6.6,
              (ball.pos.z - c.position.z) * 2.2 + c.vz * 0.35 - ball.pos.z * 0.25,
            );
            squash = 1;
            hits++;
            sfx.boing();
          }

          // Net, and soft invisible walls so the balloon always stays in play.
          if (Math.abs(ball.pos.x) < R * 0.7 && ball.pos.y < NET + R * 0.4) {
            ball.pos.x = before * R * 0.7;
            ball.vel.x = -ball.vel.x * 0.5 + before * 0.6;
          }
          if (Math.abs(ball.pos.z) > CD + 0.7 - R) { ball.pos.z = Math.sign(ball.pos.z) * (CD + 0.7 - R); ball.vel.z *= -0.7; }
          if (Math.abs(ball.pos.x) > CL + 0.5 - R) { ball.pos.x = Math.sign(ball.pos.x) * (CL + 0.5 - R); ball.vel.x *= -0.7; }

          if (ball.pos.y <= R) { ball.pos.y = R; point(ball.pos.x < 0 ? Q : P); }
        }
        squash = Math.max(0, squash - dt * 5);
        if (phase !== 'serve') balloon.scale.set(1 + squash * 0.18, 1 - squash * 0.22, 1 + squash * 0.18);
        balloon.rotation.z = clamp(-ball.vel.x * 0.06, -0.5, 0.5);
        blob.position.set(ball.pos.x, 0.035, ball.pos.z);
        blob.visible = balloon.visible;
        blob.material.opacity = clamp(1.15 - ball.pos.y * 0.14, 0.4, 1);

        marker.position.set(P.c.position.x, 0.04, P.c.position.z);
        marker.scale.setScalar(P.c.radius * 1.5);
        marker.visible = !ctx.over;

        if (ctx.frontView) { // from behind our side, looking over the net
          // Far enough back to see the whole court, and it backs away with you as you retreat.
          const back = Math.max(9.5, 14 / ctx.camera.aspect);
          const retreat = (-3 - P.c.position.x) * 0.9; // > 0 when you are behind your starting spot
          ctx.cam(-CL - back - retreat, 6.6 + Math.max(retreat, 0) * 0.25, P.c.position.z * 0.35, 0.5 - retreat * 0.3, 1.5, ball.pos.z * 0.2);
        } else {
          const far = Math.max(13.5, 22 / ctx.camera.aspect);
          ctx.cam(ball.pos.x * 0.12, 5.4, far, ball.pos.x * 0.15, 1.9, 0);
        }
        hud.set({
          left: chip(ctx.emoji(P.c.id), P.score, ctx.colorOf(P.c.id)),
          right: chip(ctx.emoji(Q.c.id), Q.score, ctx.colorOf(Q.c.id)),
          center: `First to ${WIN}`,
        });
      },
    };
  },
};
