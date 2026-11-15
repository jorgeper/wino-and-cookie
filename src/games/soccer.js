import * as THREE from 'three';
import { buildForest, makeLog, plushMaterial, canvasTexture, groundDecal, makeMarker, makeBlobShadow, PALETTE } from '../forest.js';
import { Ball, ballVsCharacter, separateCharacters } from '../physics.js';
import { toward, clamp, fmtTime, chip } from './common.js';

const L = 13, W = 8;          // half length (x) and half width (z) of the pitch
const GOAL = 2.6, GOAL_H = 1.9, GOAL_D = 1.5;
const MATCH = 150;            // seconds

export default {
  id: 'soccer',
  title: 'Forest Soccer',
  emoji: '⚽',
  blurb: 'Three a side in a forest clearing. Bump the ball into the log goal.',
  controls: '<kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>J</kbd> dash · <kbd>Space</kbd> kick / jump · <kbd>K</kbd> switch player',

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('day');
    ctx.setShadowArea(0, 0, 17);

    // Mown turf on the pitch, in the same stripes as the paint, with gaps for the chalk lines.
    const turf = (x, z) => {
      const ax = Math.abs(x), az = Math.abs(z), t = 0.1;
      if (ax > L + 0.85 || az > W + 0.85) return undefined;
      const onLine = (Math.abs(ax - L) < t && az < W + t) || (Math.abs(az - W) < t && ax < L + t) || ax < t
        || Math.abs(Math.hypot(x, z) - 2.4) < t || Math.hypot(x, z) < 0.24
        || (Math.abs(ax - (L - 3.2)) < t && az < 4 + t) || (Math.abs(az - 4) < t && ax > L - 3.2 && ax < L);
      if (onLine) return 'bare';
      const stripe = Math.floor(((x + L + 1) / (L * 2 + 2)) * 14);
      return { h: 0.075, color: stripe % 2 ? 0x86c766 : 0x97d374 };
    };
    const forest = buildForest({ seed: 7, clearing: 21, keepOut: (x, z) => Math.abs(x) < L + 3 && Math.abs(z) < W + 2, surface: turf });
    forest.name = 'forest';
    root.add(forest);

    // Pitch: mowing stripes and chalk lines.
    const PX = 36; // pixels per metre
    const tex = canvasTexture((L * 2 + 2) * PX, (W * 2 + 2) * PX, (g, w, h) => {
      const m = PX; // 1 m margin
      g.beginPath(); g.roundRect(0, 0, w, h, PX * 1.2); g.clip();
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? '#7fc061' : '#8fcc6d';
        g.fillRect((i * w) / 14, 0, w / 14 + 1, h);
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5;
      g.strokeRect(m, m, w - 2 * m, h - 2 * m);
      g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
      g.beginPath(); g.arc(w / 2, h / 2, 2.4 * PX, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath(); g.arc(w / 2, h / 2, 7, 0, Math.PI * 2); g.fill();
      for (const sx of [m, w - m - 3.2 * PX]) g.strokeRect(sx, h / 2 - 4 * PX, 3.2 * PX, 8 * PX);
    });
    root.add(ctx.own(groundDecal(L * 2 + 2, W * 2 + 2, tex)));

    // Low log border (the ball bounces off it) and the two goals.
    const props = new THREE.Group();
    root.add(props);
    const border = (ax, az, bx, bz) => props.add(makeLog([ax, 0.13, az], [bx, 0.13, bz], 0.13, PALETTE.wood));
    for (const s of [-1, 1]) {
      border(-L - 0.2, s * (W + 0.13), L + 0.2, s * (W + 0.13));
      border(s * (L + 0.13), GOAL + 0.2, s * (L + 0.13), W + 0.2);
      border(s * (L + 0.13), -GOAL - 0.2, s * (L + 0.13), -W - 0.2);
    }
    const netTex = canvasTexture(128, 128, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
      for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    const net = (w, h, pos, rot) => {
      const t = netTex.clone(); t.repeat.set(w / 0.5, h / 0.5); t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(...pos); m.rotation.set(...rot);
      props.add(m);
    };
    for (const s of [-1, 1]) {
      const x0 = s * L, x1 = s * (L + GOAL_D);
      for (const z of [-GOAL, GOAL]) {
        props.add(makeLog([x0, 0, z], [x0, GOAL_H, z], 0.11, PALETTE.woodLight));
        props.add(makeLog([x1, 0, z], [x1, GOAL_H * 0.7, z], 0.08, PALETTE.wood));
        props.add(makeLog([x0, GOAL_H, z], [x1, GOAL_H * 0.7, z], 0.07, PALETTE.wood));
      }
      props.add(makeLog([x0, GOAL_H, -GOAL - 0.1], [x0, GOAL_H, GOAL + 0.1], 0.11, PALETTE.woodLight));
      props.add(makeLog([x1, GOAL_H * 0.7, -GOAL], [x1, GOAL_H * 0.7, GOAL], 0.07, PALETTE.wood));
      net(GOAL * 2, GOAL_H * 0.7, [x1, GOAL_H * 0.35, 0], [0, Math.PI / 2, 0]);
      for (const z of [-GOAL, GOAL]) net(GOAL_D, GOAL_H * 0.7, [(x0 + x1) / 2, GOAL_H * 0.35, z], [0, 0, 0]);
    }
    ctx.own(props);

    // The ball: a patchwork plush ball.
    const ballGeo = new THREE.IcosahedronGeometry(0.34, 1);
    const colors = [], col = new THREE.Color();
    for (let f = 0; f < ballGeo.attributes.position.count / 3; f++) {
      col.set(f % 4 === 0 ? 0xff8a6b : f % 7 === 0 ? 0x6bb6ff : 0xfffaf0);
      for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
    }
    ballGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const ballMesh = new THREE.Mesh(ballGeo, plushMaterial(0xffffff, { vertexColors: true, flatShading: true }));
    ballMesh.castShadow = true;
    root.add(ctx.own(ballMesh));
    const ball = new Ball({ radius: 0.34, mesh: ballMesh, bounce: 0.55, groundDrag: 0.75 });
    const blob = ctx.own(makeBlobShadow(0.5));
    root.add(blob);

    // Teams. A (the player's species) attacks +x.
    const mkTeam = (id, dir) => {
      const team = { id, dir, score: 0, players: [] };
      const homes = [[-L + 1.2, 0], [-4.5, -3], [-2.6, 3.2]];
      homes.forEach(([x, z], i) => {
        const c = ctx.spawn(id, { runSpeed: 3.5 });
        const p = { c, team, keeper: i === 0, home: { x: x * dir, z: z * dir }, kickCd: 0, aimZ: 0, role: 'support' };
        team.players.push(p);
      });
      return team;
    };
    const A = mkTeam(ctx.playerId, 1), B = mkTeam(ctx.rivalId, -1);
    const teams = [A, B];
    const all = [...A.players, ...B.players];
    const allChars = all.map((p) => p.c);
    for (const p of B.players) p.c.speedMul = 0.84;
    for (const p of A.players) p.c.speedMul = 0.92;
    let me = A.players[1];
    const setMe = (p) => { me.c.speedMul = 0.92; me = p; me.c.speedMul = 1; };
    setMe(me);
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    let lastScorer = null, dashCd = 0;
    let phase = 'kickoff', phaseT = 1.4, timeLeft = MATCH, bumpCd = 0, roleT = 0;
    const v = new THREE.Vector3(), gd = new THREE.Vector3();

    function resetPositions() {
      for (const p of all) p.c.place(p.home.x, p.home.z, p.team.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      ball.pos.set(0, ball.radius, 0);
      ball.vel.set(0, 0, 0);
    }
    resetPositions();
    hud.banner('Kick off!', 1.3);
    hud.hint(this.controls);
    sfx.whistle();

    function kick(p, dx, dz, power, loft) {
      const l = Math.hypot(dx, dz) || 1;
      ball.vel.set((dx / l) * power, loft, (dz / l) * power);
      p.c.hop(3.2);
      p.kickCd = p === me && !ctx.auto ? 0.3 : 0.9 + Math.random() * 0.8;
      p.aimZ = (Math.random() - 0.5) * 3.4;
      sfx.kick();
    }

    /** Get behind the ball (relative to the goal we attack) and drive it forward. */
    function chase(p, clear = false) {
      const c = p.c, bx = ball.pos.x + ball.vel.x * 0.18, bz = ball.pos.z + ball.vel.z * 0.18;
      gd.set(p.team.dir * L - bx, 0, p.aimZ - bz).normalize();
      const rx = bx - c.position.x, rz = bz - c.position.z, d = Math.hypot(rx, rz) || 1;
      const aligned = (rx * gd.x + rz * gd.z) / d;
      const reach = c.radius + ball.radius + 0.4;
      if (d < reach && aligned > (clear ? 0.15 : 0.55) && p.kickCd <= 0 && ball.pos.y < 1) {
        const far = Math.abs(p.team.dir * L - bx) > 11;
        kick(p, gd.x, gd.z, clear ? 10.5 : far ? 7.5 : 8.5 + Math.random() * 2.5, clear ? 5 : 2.5 + Math.random() * 2);
      }
      if (aligned > 0.5) return toward(c, bx + gd.x * 0.6, bz + gd.z * 0.6, { stop: 0 });
      let tx = bx - gd.x * 1.1, tz = bz - gd.z * 1.1;
      if (aligned < 0) { // we're on the wrong side: swing around it rather than through it
        const side = (c.position.x - bx) * -gd.z + (c.position.z - bz) * gd.x >= 0 ? 1 : -1;
        tx += -gd.z * side * 1.1; tz += gd.x * side * 1.1;
      }
      return toward(c, tx, tz, { stop: 0 });
    }

    function aiInput(p) {
      const c = p.c, t = p.team, b = ball.pos;
      if (p.keeper) {
        const gx = -t.dir * L;
        const danger = (b.x - gx) * t.dir < 5.5 && Math.abs(b.z) < 5;
        if (danger && Math.hypot(b.x - c.position.x, b.z - c.position.z) < 4.2) return chase(p, true);
        return toward(c, gx + t.dir * 1.1, clamp(b.z * 0.7, -GOAL + 0.4, GOAL - 0.4), { stop: 0.15, slow: 0.8 });
      }
      if (p.role === 'chase') return chase(p);
      const sx = clamp(b.x - t.dir * 4, -L + 3, L - 3);
      const sz = clamp(b.z > 0 ? b.z - 4.5 : b.z + 4.5, -W + 1.5, W - 1.5);
      return toward(c, sx, sz, { stop: 0.4 });
    }

    function assignRoles() {
      for (const t of teams) {
        const out = t.players.filter((p) => !p.keeper);
        const d = out.map((p) => Math.hypot(ball.pos.x - p.c.position.x, ball.pos.z - p.c.position.z));
        out[0].role = d[0] <= d[1] ? 'chase' : 'support';
        out[1].role = d[0] <= d[1] ? 'support' : 'chase';
        // The human always counts as a chaser, so their teammate holds a supporting spot.
        if (t === A && !ctx.auto) for (const p of out) p.role = p === me ? 'chase' : 'support';
      }
    }

    function humanInput() {
      const c = me.c, m = input.move();
      c.speedMul = input.down('ShiftLeft', 'ShiftRight') ? 1.3 : 1; // hold Shift to sprint
      // J to dash: a quick burst the way you are steering, then a short breather.
      if (dashCd <= 0 && c.grounded && input.hit('KeyJ')) {
        const dir = m.x || m.z ? v.set(m.x, 0, m.z) : c.facing(v);
        c.knock.addScaledVector(dir, 10);
        dashCd = 1.1;
        sfx.bump();
        ctx.burst(v.set(c.position.x, 0.15, c.position.z), { count: 8, colors: [0xffffff, 0xd8f0c0], speed: 1.6, up: 1.5, life: 0.5, size: 0.07 });
      }
      if (input.hit('Space')) {
        const rx = ball.pos.x - c.position.x, rz = ball.pos.z - c.position.z, d = Math.hypot(rx, rz) || 1;
        const dir = m.x || m.z ? v.set(m.x, 0, m.z) : c.facing(v);
        if (d < c.radius + ball.radius + 0.6 && ball.pos.y < 1.3 && (rx * dir.x + rz * dir.z) / d > -0.1 && me.kickCd <= 0) {
          kick(me, dir.x * 0.65 + (rx / d) * 0.35, dir.z * 0.65 + (rz / d) * 0.35, 11.5, 3.4);
        } else c.jump();
      }
      return m.x || m.z ? { x: m.x, z: m.z, run: true } : null;
    }

    function goal(team, side) {
      team.score++;
      phase = 'goal'; phaseT = 2.4;
      hud.banner(team === A ? 'GOAL!' : `${ctx.nameOf(B.id)} team scores`, 2.2);
      (team === A ? sfx.cheer : sfx.lose)();
      ctx.burst(v.set(side * (L + 0.5), 1.2, ball.pos.z), { count: 46, speed: 6, up: 7 });
      ball.vel.multiplyScalar(0.25);
    }

    function updateHud() {
      hud.set({
        left: chip(ctx.emoji(A.id), A.score, ctx.colorOf(A.id)),
        right: chip(ctx.emoji(B.id), B.score, ctx.colorOf(B.id)),
        center: fmtTime(timeLeft),
      });
    }
    updateHud();

    return {
      get state() { return { a: A.score, b: B.score, timeLeft, phase }; },

      update(dt) {
        phaseT -= dt;
        bumpCd -= dt;
        dashCd -= dt;
        if (phase === 'kickoff' && phaseT <= 0) phase = 'play';
        if (phase === 'goal' && phaseT <= 0 && !ctx.over) { resetPositions(); phase = 'kickoff'; phaseT = 1.1; sfx.whistle(); }

        const live = phase === 'play' && !ctx.over;
        if (live) {
          timeLeft -= dt;
          if ((roleT -= dt) <= 0) { assignRoles(); roleT = 0.35; }
        }

        // K hands control to the other outfield player. Done once per frame, before anyone
        // moves (inside the loop below both players would see the key and swap straight back).
        if (live && !ctx.auto && input.hit('KeyK')) { setMe(A.players[me === A.players[1] ? 2 : 1]); sfx.blip(); }
        for (const p of all) {
          p.kickCd -= dt;
          let inp = null;
          if (live) inp = p === me && !ctx.auto ? humanInput() : p === me ? chase(p) : aiInput(p);
          else if (phase === 'goal' && p.team === lastScorer && p.c.grounded && Math.random() < dt * 1.5) p.c.hop(4);
          p.c.update(dt, inp);
          if (!inp && p.c.grounded) p.c.facePoint(ball.pos.x, ball.pos.z, dt, 5);
          p.c.position.x = clamp(p.c.position.x, -L - 0.4, L + 0.4);
          p.c.position.z = clamp(p.c.position.z, -W - 0.4, W + 0.4);
        }
        separateCharacters(allChars);

        // Ball
        ball.step(dt);
        if (ball.bounced > 3) sfx.pop();
        for (const p of all) {
          const n = ballVsCharacter(ball, p.c);
          if (!n) continue;
          const c = p.c;
          const vn = (ball.vel.x - c.vx) * n.x + (ball.vel.y - c.velocity.y) * n.y + (ball.vel.z - c.vz) * n.z;
          if (vn < 0) {
            ball.vel.addScaledVector(n, -1.3 * vn);
            if (vn < -3.5 && bumpCd <= 0) { sfx.bump(); bumpCd = 0.15; }
          }
        }
        const r = ball.radius, b = ball.pos;
        if (Math.abs(b.z) > W - r) { b.z = Math.sign(b.z) * (W - r); ball.vel.z *= -0.6; }
        if (Math.abs(b.x) > L - r) {
          const side = Math.sign(b.x);
          const inMouth = Math.abs(b.z) < GOAL - r * 0.4 && b.y < GOAL_H;
          if (!inMouth) { b.x = side * (L - r); ball.vel.x *= -0.6; }
          else {
            b.z = clamp(b.z, -GOAL + r, GOAL - r);
            if (Math.abs(b.x) > L + GOAL_D - r) { b.x = side * (L + GOAL_D - r); ball.vel.x *= -0.2; }
            if (live && Math.abs(b.x) > L + r * 0.6) { lastScorer = side > 0 ? A : B; goal(lastScorer, side); }
          }
        }
        blob.position.set(b.x, 0.035, b.z);
        blob.material.opacity = clamp(1.1 - b.y * 0.25, 0.25, 1);

        marker.position.set(me.c.position.x, 0.04, me.c.position.z);
        marker.scale.setScalar(me.c.radius * 1.55 + Math.sin(performance.now() / 180) * 0.03);
        marker.visible = !ctx.over;

        if (ctx.frontView) { // from behind our goal, looking up the pitch at theirs
          const back = Math.max(15, 24 / ctx.camera.aspect);
          ctx.cam(b.x * 0.75 - back, 10.5, b.z * 0.45, b.x * 0.75 + 3, 0.4, b.z * 0.5);
        } else ctx.cam(b.x * 0.55, 12.5, 18.5 + b.z * 0.15, b.x * 0.62, 0.4, b.z * 0.3);
        updateHud();

        if (timeLeft <= 0 && !ctx.over) {
          sfx.whistle();
          const title = A.score > B.score ? 'You win!' : A.score < B.score ? 'So close!' : "It's a draw";
          if (A.score > B.score) sfx.cheer();
          ctx.finish({ title, text: `${ctx.emoji(A.id)} ${A.score} – ${B.score} ${ctx.emoji(B.id)}`, won: A.score > B.score });
        }
      },
    };
  },
};
