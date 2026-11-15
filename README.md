# Wino and Cookie Games

Four cozy mini-games in a low-poly forest, starring Wino the penguin and Cookie the deer
from `../three-stuff-demo`. Same models, same animation clips, fabric shading always on.

```
npm install
npm run dev        # http://localhost:5173
```

The launcher lets you pick a game and who you play as. `1`–`4` start a game, `Esc` pauses, `M` mutes.

| Game | How it plays | Controls |
|---|---|---|
| ⚽ Forest Soccer | 3 v 3, two and a half minutes. Run into the ball to dribble it | WASD, Space kicks (or jumps), Q switches player |
| 🎈 Balloon Volleyball | 1 v 1 over a net with a slow, floaty balloon. First to 5 | WASD, Space jumps; hitting it in the air is a spike |
| 🛋️ Pillow Sumo | Shove the other stuffy off the cushion. First to 3 rounds | WASD, Space pounces (ring under you is bright when ready) |
| 🐣 Herd the Babies | Eight little stuffies run away from you. Get them into the pen before sunset | WASD, Space hops |

## Layout

* `src/engine.js`: renderer, lighting moods, input, HUD, particles, and starting/stopping games.
* `src/character.js`: adapted from the demo. Steering is in world space so players and AI share it; adds knock-back and a floor that can drop away.
* `src/fabric.js`: copied unchanged from the demo.
* `src/forest.js`: the forest kit, drawn with instancing. Trees, bushes, rocks, stumps, mushrooms and flowers are the models in `assets/<name>/<name>.glb`; any new model dropped into its folder is loaded automatically.
* `src/physics.js`: ball, ball-vs-character, character separation, fence segments.
* `src/games/*.js`: one file per game, plus `lobby.js` (the scene behind the launcher).
  A game is `{ id, title, emoji, blurb, controls, create(ctx) }` and `create` returns `{ update(dt) }`.
  Add it to the `GAMES` list in `src/main.js` to put it on the launcher.

## Characters

`public/models/` holds copies of the demo's exported `.glb` files and `manifest.json`.
After re-exporting in the demo, copy them over again:

```
cp ../three-stuff-demo/public/models/* public/models/
```

Cookie's file is called `cookie-animations.glb` here. The demo exports it under a different name, so after copying, rename it and keep the `id` and `url` in `manifest.json` in step.

Sizes here differ from the playground (Wino 1.25, Cookie 1) so the games are fair; see `BASE` in `src/engine.js`.

## Handy URL switches

* `?game=soccer` (or `volley`, `sumo`, `herd`) skips the launcher.
* `?auto` lets the computer play your side too.
* `?speed=4` fast-forwards.
