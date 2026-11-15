import { buildForest } from '../forest.js';
import { separateCharacters } from '../physics.js';
import { toward } from './common.js';

// The scene behind the game picker: Wino and Cookie pottering about in a clearing.
export default {
  id: 'lobby',
  create(ctx) {
    ctx.setMood('golden');
    ctx.setShadowArea(0, 0, 9);
    const forest = buildForest({ seed: 3, clearing: 9, keepOut: (x, z) => { const r = Math.hypot(x, z); return r < 2.5 || (r > 6 && r < 10.5); }, trees: 110, deco: 1.4 });
    forest.name = 'forest';
    ctx.root.add(forest);

    const pals = [ctx.spawn(ctx.WINO), ctx.spawn(ctx.COOKIE)].map((c, i) => {
      c.place(i ? 1.1 : -1.1, 0, 0);
      return { c, t: 2 + i * 1.7, goal: null };
    });
    let angle = 0.25;

    return {
      update(dt) {
        for (const p of pals) {
          if ((p.t -= dt) <= 0) {
            p.t = 2.5 + Math.random() * 3.5;
            const roll = Math.random();
            if (roll < 0.25) p.c.jump();
            p.goal = roll < 0.7 ? { x: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 4 } : null;
          }
          const inp = p.goal && toward(p.c, p.goal.x, p.goal.z, { stop: 0.3, run: false });
          p.c.update(dt, inp);
          if (!inp && p.c.grounded) p.c.faceYaw(angle, dt, 3); // look at the camera
        }
        separateCharacters(pals.map((p) => p.c));
        angle += dt * 0.06;
        const wide = ctx.camera.aspect < 1.1 ? 11.5 : 8.2;
        ctx.cam(Math.sin(angle) * wide, 2.6, Math.cos(angle) * wide, 0, 0.2, 0);
      },
    };
  },
};
