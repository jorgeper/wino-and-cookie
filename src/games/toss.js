import * as THREE from 'three';
import { buildForest, makeLog, makeMarker, modelWidth, Scatter, PALETTE } from '../forest.js';
import { toward, clamp, makeDots } from './common.js';

const X0 = 8.5;        // how far each thrower stands from the middle
const G = 14;          // gravity on the acorn
const VMAX = 17.5;     // hardest throw, m/s
const HEARTS = 5;

/** Three tree stumps stacked in the middle: [x, y, radius] of the round each one blocks, seen from the side. */
const PILE = [[-0.62, 0.6, 0.6], [0.62, 0.6, 0.6], [0, 1.66, 0.6]];

export default {
  id: 'toss',
  title: 'Acorn Toss',
  emoji: '🌰',
  blurb: 'Take turns lobbing acorns over the pile of stumps. Mind the wind. A bonk on the head counts double.',
  controls: '<kbd>Drag</kbd> back and let go to throw · or <kbd>↑↓</kbd> angle <kbd>←→</kbd> power <kbd>Space</kbd> throw',
  touch: { stick: false, buttons: [], hint: '<b>Drag</b> back and let go to throw' },

  create(ctx) {
    const { root, hud, sfx, input } = ctx;
    ctx.setMood('day');
    ctx.setShadowArea(0, 0, 13);

    // Nothing between the camera and the throwers.
    const forest = buildForest({ seed: 77, clearing: 13, trees: 100,
      keepOut: (x, z) => (Math.abs(x) < 13 && z > -3.5) || Math.hypot(x, z) < 4,
      surface: (x, z) => (Math.abs(x) < 1.6 && Math.abs(z) < 1.7 ? 'bare' : undefined) });
    forest.name = 'forest';
    root.add(forest);

    // The pile is the tree-stump model three times over: two side by side and one on top.
    // (Plain logs if the model is missing.)
    const stumpWidth = modelWidth('tree-stump');
    if (stumpWidth) {
      const pile = new Scatter();
      for (const [x, y, r] of PILE) {
        const across = (r * 2 * 1.1) / stumpWidth; // the roots flare a little past the trunk the acorn hits
        pile.add('tree-stump', [x, y - r, 0], [across, r * 2, across], y > 1 ? 0xffffff : 0xe6dccb, { rotY: 1 + x * 2.1 });
      }
      root.add(pile.build());
    } else for (const [x, y, r] of PILE) root.add(ctx.own(makeLog([x, y, -1.5], [x, y, 1.5], r, y > 1 ? PALETTE.wood : PALETTE.woodDark)));

    // The acorn: a nut with a darker cap and a little stalk.
    const acorn = new THREE.Group();
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10).scale(1, 1.25, 1), new THREE.MeshStandardMaterial({ color: 0xb9793a, roughness: 0.6 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 1, flatShading: true }));
    cap.position.y = 0.06;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.1), cap.material);
    stalk.position.y = 0.27;
    nut.castShadow = cap.castShadow = true;
    acorn.add(nut, cap, stalk);
    acorn.scale.setScalar(2.1); // drawn big: it is a long way from the camera
    acorn.visible = false;
    root.add(ctx.own(acorn));

    const dots = makeDots(12, 0xffffff, 0.13);
    root.add(dots);
    const marker = ctx.own(makeMarker(0xffffff));
    root.add(marker);

    const mk = (id, side) => ({ c: ctx.spawn(id), side, hearts: HEARTS, aim: { angle: 0.85, power: 0.62 }, miss: 0, tries: 0 });
    const P = mk(ctx.playerId, -1), Q = mk(ctx.rivalId, 1);
    for (const p of [P, Q]) p.c.place(p.side * X0, 0, -p.side * Math.PI / 2);

    let turn = Q, phase = 'rest', phaseT = 1.1, // the first 'rest' hands the turn to the player
       wind = 0, drag = null, aiT = 0, time = 0;
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(), v = new THREE.Vector3();
    const other = (p) => (p === P ? Q : P);
    const hand = (p) => [p.c.position.x - p.side * 0.25, p.c.height * 0.95, 0];
    const launch = (p) => { const s = p.aim.power * VMAX; return [-p.side * Math.cos(p.aim.angle) * s, Math.sin(p.aim.angle) * s]; };

    /** Fly an acorn from `p` without drawing it; returns how far past (+) or short (-) of the other thrower it comes down. */
    function simulate(p, angle, power) {
      let [x, y] = hand(p), vx = -p.side * Math.cos(angle) * power * VMAX, vy = Math.sin(angle) * power * VMAX;
      const o = other(p), ty = o.c.height * 0.5, dir = -p.side;
      for (let i = 0; i < 400; i++) {
        vx += wind * 0.02; vy -= G * 0.02; x += vx * 0.02; y += vy * 0.02;
        if (PILE.some(([px, py, r]) => Math.hypot(x - px, y - py) < r + 0.16)) return -99;
        if (vy < 0 && y <= ty) return (x - o.c.position.x) * dir;
      }
      return 99;
    }

    function newTurn(p) {
      turn = p; phase = 'aim'; drag = null;
      wind = Math.round((Math.random() * 2 - 1) * 35) / 10;
      if (Math.abs(wind) < 0.4) wind = 0;
      aiT = 1.1 + Math.random() * 0.7;
      const mine = p === P && !ctx.auto;
      hud.banner(mine ? 'Your throw' : `${ctx.nameOf(p.c.id)}'s throw`, 1.0);
      if (!mine) aiAim(p);
    }

    /** The rival picks a steep angle, works out the power that would land it, then fumbles it a little less each try. */
    function aiAim(p) {
      const angle = 0.8 + Math.random() * 0.35;
      let lo = 0.3, hi = 1;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (simulate(p, angle, mid) < 0) lo = mid; else hi = mid; }
      const slop = Math.max(0.05, 0.17 - p.tries * 0.02);
      p.aim.angle = angle + (Math.random() - 0.5) * 0.08;
      p.aim.power = clamp((lo + hi) / 2 * (1 + (Math.random() * 2 - 1) * slop), 0.25, 1);
      p.tries++;
    }

    function throwIt(p) {
      const [vx, vy] = launch(p);
      pos.fromArray(hand(p)); vel.set(vx, vy, 0);
      acorn.visible = true;
      phase = 'fly';
      p.c.hop(2.4);
      sfx.kick();
      dots.show([]);
    }

    function endFlight(wait = 0.9) { phase = 'rest'; phaseT = wait; }

    function bonk(p, head) {
      p.hearts = Math.max(0, p.hearts - (head ? 2 : 1));
      p.c.knock.x += p.side * (head ? 6 : 4);
      p.c.hop(head ? 4.5 : 3);
      ctx.burst(v.copy(pos), { count: head ? 26 : 14, colors: [0xffe9a8, 0xb9793a, 0xffffff], speed: 3.5, up: 4, life: 0.7, size: 0.1 });
      sfx.bump();
      const mine = p === Q;
      hud.banner(head ? (mine ? 'Bonk! Right on the head' : 'Ouch, on the head!') : (mine ? 'Got them!' : 'Oof!'), 1.2);
      (mine ? sfx.point : sfx.lose)();
      if (p.hearts <= 0) {
        if (mine) sfx.cheer();
        ctx.finish({ title: mine ? 'You win!' : 'So close!', text: `${ctx.emoji(P.c.id)} ${'❤️'.repeat(P.hearts) || '💤'}  ·  ${ctx.emoji(Q.c.id)} ${'❤️'.repeat(Q.hearts) || '💤'}`, won: mine });
      }
    }

    const hearts = (p) => `<span class="dot" style="background:${ctx.colorOf(p.c.id)}"></span>${ctx.emoji(p.c.id)} <span class="hearts">${'❤️'.repeat(p.hearts)}<span class="gone">${'❤️'.repeat(HEARTS - p.hearts)}</span></span>`;
    hud.hint(this.controls);

    return {
      get state() { return { a: P.hearts, b: Q.hearts, phase, turn: turn === P ? 'player' : 'rival', wind, aim: turn.aim }; },

      update(dt) {
        time += dt; phaseT -= dt;
        if (phase === 'rest' && phaseT <= 0 && !ctx.over) newTurn(other(turn));

        const mine = turn === P && !ctx.auto;
        if (phase === 'aim' && !ctx.over) {
          const a = turn.aim;
          if (mine) {
            const ptr = input.pointer;
            if (ptr.pressed) drag = { x: ptr.x, y: ptr.y };
            if (drag) {
              // Pull back like a slingshot: the throw goes the opposite way, harder the further you pull.
              const dx = drag.x - ptr.x, dy = ptr.y - drag.y, len = Math.hypot(dx, dy);
              if (len > 8) {
                a.angle = clamp(Math.atan2(dy, Math.abs(dx) + 0.001), 0.1, 1.45);
                a.power = clamp(len / (Math.min(innerWidth, innerHeight) * 0.42), 0.15, 1);
              }
              if (ptr.released) { if (len > 8) throwIt(turn); drag = null; }
            }
            const turnBy = (input.down('ArrowUp', 'KeyW') ? 1 : 0) - (input.down('ArrowDown', 'KeyS') ? 1 : 0);
            const push = (input.down('ArrowRight', 'KeyD') ? 1 : 0) - (input.down('ArrowLeft', 'KeyA') ? 1 : 0);
            a.angle = clamp(a.angle + turnBy * dt * 0.7, 0.1, 1.45);
            a.power = clamp(a.power + push * dt * 0.35, 0.15, 1);
            if (phase === 'aim' && input.hit('Space')) throwIt(turn);
          } else if ((aiT -= dt) <= 0) throwIt(turn);
          if (phase === 'aim') {
            // Only the start of the arc is shown, and without the wind: the rest is judgement.
            const [x0, y0] = hand(turn), [vx, vy] = launch(turn), pts = [];
            for (let i = 1; i <= (mine ? 12 : 5); i++) { const t = i * 0.085; pts.push([x0 + vx * t, y0 + vy * t - 0.5 * G * t * t, 0]); }
            dots.show(pts);
          }
        }

        if (phase === 'fly') {
          const steps = 3, h = dt / steps;
          for (let i = 0; i < steps && phase === 'fly'; i++) {
            vel.x += wind * h; vel.y -= G * h;
            pos.addScaledVector(vel, h);
            const hitLog = PILE.find(([px, py, r]) => Math.hypot(pos.x - px, pos.y - py) < r + 0.16);
            if (hitLog) {
              sfx.bump();
              ctx.burst(v.copy(pos), { count: 8, colors: [0xb9793a, 0x8a5a2b], speed: 2, up: 2.5, life: 0.5, size: 0.08 });
              acorn.visible = false; endFlight();
              break;
            }
            for (const p of [P, Q]) {
              const c = p.c, dx = Math.abs(pos.x - c.position.x), y = pos.y - c.position.y;
              if (p !== turn && dx < c.radius + 0.14 && y > 0 && y < c.height + 0.1) {
                acorn.visible = false;
                bonk(p, y > c.height * 0.62);
                endFlight(1.5);
                break;
              }
            }
            if (phase === 'fly' && (pos.y < 0.12 || Math.abs(pos.x) > 26)) {
              if (pos.y < 0.12) {
                sfx.pop();
                ctx.burst(v.set(pos.x, 0.15, 0), { count: 8, colors: [0x9ccf6a, 0xd9c08a], speed: 1.6, up: 2.2, life: 0.45, size: 0.07 });
                const gap = Math.abs(pos.x - other(turn).c.position.x);
                if (turn === P && !ctx.auto) hud.banner(gap < 1.2 ? 'So close!' : pos.x * -turn.side < other(turn).c.position.x * -turn.side ? 'Too short' : 'Too far', 0.9);
              }
              acorn.visible = false; endFlight();
            }
          }
          acorn.position.copy(pos);
          acorn.rotation.z -= dt * 9 * Math.sign(vel.x);
        }

        for (const p of [P, Q]) {
          // Knocked back by a bonk? Trot back to the mark.
          const inp = phase !== 'fly' ? toward(p.c, p.side * X0, 0, { stop: 0.12, run: false }) : null;
          p.c.update(dt, inp);
          if (!inp && p.c.grounded) p.c.faceYaw(-p.side * Math.PI / 2, dt, 6);
          if (ctx.over && p.hearts > 0 && p.c.grounded && Math.random() < dt * 2) p.c.hop(4);
        }

        marker.position.set(turn.c.position.x, 0.04, 0);
        marker.scale.setScalar(turn.c.radius * 1.5);
        marker.visible = phase === 'aim' && !ctx.over;

        const far = Math.max(17.5, 29 / ctx.camera.aspect);
        const fx = phase === 'fly' ? clamp(pos.x * 0.25, -2.5, 2.5) : 0, fy = phase === 'fly' ? clamp((pos.y - 3) * 0.35, 0, 2.5) : 0;
        ctx.cam(fx, 2.4 + fy, far, fx, 3.7 + fy, 0);
        const arrow = wind === 0 ? 'no wind' : `${wind < 0 ? '←' : ''} wind ${Math.abs(wind).toFixed(1)} ${wind > 0 ? '→' : ''}`;
        hud.set({ left: hearts(P), right: hearts(Q), center: `🍃 ${arrow}` });
      },
    };
  },
};
