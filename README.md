# Wino and Cookie Games

Seven cozy mini-games in a low-poly forest, starring Wino the penguin and Cookie the deer,
plus a Testing Ground for trying out the characters, their animations and the graphics options.

```
npm install
npm run dev          # http://localhost:5173
npm run dev:blender  # same, and re-exports characters/*.blend whenever you save one
```

The launcher lets you pick a game and who you play as. `1`–`8` start a game, `Esc` pauses, `M` mutes, `G` opens the graphics settings.

| Game | How it plays | Controls |
|---|---|---|
| ⚽ Forest Soccer | 3 v 3, two and a half minutes. Run into the ball to dribble it | WASD, Shift sprints, J dashes, Space kicks (or jumps), K switches player |
| 🎈 Balloon Volleyball | 1 v 1 over a net with a slow, floaty balloon. First to 5 | WASD, Space jumps; hitting it in the air is a spike |
| 🛋️ Pillow Sumo | Shove the other stuffy off the cushion. First to 3 rounds | WASD, Space pounces (ring under you is bright when ready) |
| 🐣 Herd the Babies | Eight little stuffies run away from you. Get them into the pen before sunset | WASD, Space hops |
| 🌰 Acorn Toss | Take turns lobbing acorns at each other over a pile of tree stumps, with a wind that changes every throw. Five hearts each; a bonk on the head costs two | Drag back and let go (like a slingshot), or ↑↓ angle, ←→ power, Space throws |
| ✨ Firefly Jars | Night. Catch more fireflies than your friend in a minute; they shy away, some fly high, gold ones count triple. Your jar glows brighter as it fills | WASD, Space jumps |
| ⛄ Snowball Fort | A snowed-in forest. Lob snowballs over the walls, knock blocks out of their fort and dodge theirs. First to 5 hits | WASD, hold Space to wind up (the ring shows where it lands), let go to throw |

## Phones and tablets

On a touch screen (iPhone, iPad) the games show a thumb stick on the left and action buttons on the
right; `src/touch.js` feeds them into the same input the keyboard uses, so a game only has to say
which buttons it wants (`touch: { buttons: [{ code: 'Space', label: 'Jump' }], hint }` in its definition).
Pushing the stick all the way sprints. Acorn Toss is played by dragging. Holding the device sideways
shows the most of each game. Add `?touch` to the address to try the touch controls on a computer.

## Graphics settings (the ⚙ button, or `G`)

Saved in the browser. **Reset** goes back to the defaults; **Make it pretty** switches on everything that looks good.

| Section | Option | What it does |
|---|---|---|
| Wino & Cookie | Fabric shading | Fabric sheen plus a procedural pile pattern: terry loops (Wino), velour (Cookie), felt (beak/feet) |
| | Fuzzy fur, Fur length | Extra copies of each body pushed out along the surface and cut into strands |
| Scenery | Scenery detail, Strength | Shaders on the forest models: leaf clumps with sun glowing through and wind sway, grooved bark (dashes on birch), speckled and cracked stone |
| Grass | Grass, Density, Height | Tufts of blades between everything; mown short on the soccer pitch, taller under the trees |
| | Wind | How hard the grass and the foliage sway |
| Light & shadow | Lighting | Auto uses each game's own mood; Day / Golden hour / Dusk / Night force one |
| | Shadows | Standard, Extra soft (VSM blur), Crisp HD (4096 map) |
| | Ambient occlusion | GTAO: darkens creases and contact areas |
| Camera | Game view | Soccer and volleyball: from behind your side looking at the opponent (default), or from the sideline. The movement keys turn with it |
| | Anti-aliasing | Standard MSAA, SMAA, Supersample 1.5× |
| | Toy camera | Tilt-shift depth of field |
| | Cozy colour grade | Warm grade, vignette, light film grain |

The defaults are the original look plus grass.

## Testing Ground (`8`, or `?game=testing`)

The white grid room that used to be the separate `three-stuff-demo`. Click a character to take control:
the mouse is captured and turns the camera. WASD / arrows move · Shift run · Space jump · scroll zooms ·
Tab / 1–2 switch character · Esc frees the mouse, Esc again releases the character.
The panel lists every clip in the selected character's file (click to preview), with an animation-speed
slider and a skeleton toggle. **Room light** picks Studio, Golden hour, Soft overcast or Bedtime.
**Photo mode** freezes the scene and path-traces it; it sharpens over time and **Save PNG** downloads it.
Characters are full size here (Wino is twice Cookie's size); the games use closer sizes so they are fair.

## Layout

* `src/engine.js`: renderer, lighting moods, input, HUD, particles, and starting/stopping games.
* `src/graphics.js`: the settings and their defaults, shadows, anti-aliasing and the post effects. `src/settings.js` is the panel.
* `src/character.js`: steering is in world space so players and AI share it; knock-back, a floor that can drop away, clip preview.
* `src/fabric.js`: plush fabric shading and fur shells. Presets are at the top of the file.
* `src/forest.js`: the forest kit, drawn with instancing. Trees, bushes, rocks, stumps, mushrooms and flowers are the models in `assets/<name>/<name>.glb`; any new model dropped into its folder is loaded automatically. The forest also keeps the camera's view clear: a tree standing between the camera and a game's play area (its `keepOut`, or `view` if given) shrinks away, which matters most on an upright phone where the camera pulls far back.
* `src/scenery-shader.js`: the leaf / bark / stone detail. `SCENERY_KINDS` says what each model is made of; add a line for a new model.
* `src/grass.js`: the grass. A game passes `surface(x, z)` to `buildForest` to say where it is bare or mown.
* `src/physics.js`: ball, ball-vs-character, character separation, fence segments.
* `src/games/*.js`: one file per game, plus `lobby.js` (the scene behind the launcher) and `testing.js` (the Testing Ground, with `src/photo.js`).
  A game is `{ id, title, emoji, blurb, controls, create(ctx) }` and `create` returns `{ update(dt) }`.
  Add it to the `GAMES` list in `src/main.js` to put it on the launcher.

## Characters and the Blender pipeline

```
characters/*.blend ──(Blender, headless)──▶ public/models/<name>.glb + manifest.json ──▶ browser
```

* `characters/` is the drop folder. Every `.blend` in it becomes one character; `characters/characters.json` sets its name, colour, size and fabric.
* `npm run export` exports the `.blend` files that changed (`npm run export -- --all` forces everything) and rewrites `public/models/manifest.json`. It needs Blender; set `BLENDER_PATH` if it is not in the usual place.
* `npm run dev:blender` does that automatically on every save and reloads the browser. In the Testing Ground the camera and character positions are kept across the reload.
* `tools/export_blend.py` runs inside Blender: visible objects only, every Action as a clip, textures capped at 2048px. It also measures how each clip travels so feet don't slide.
* Clip names decide what the game uses (case and spaces are ignored): `Idle`, `Walk`, `Run`, `JumpStart`, `JumpAir`, `Land`. Missing ones fall back. Actions with "preview" in the name, or starting with `_`, are not exported.
* Keep the root stationary, face **-Y** in Blender, stand on Z=0, 1 unit = 1 metre, one armature per file.

Sizes in the games differ from the Testing Ground (Wino 1.25, Cookie 1) so the games are fair; see `BASE` in `src/engine.js`.

## Handy URL switches

* `?game=soccer` (or `volley`, `sumo`, `herd`, `toss`, `fireflies`, `snow`, `testing`) skips the launcher.
* `?auto` lets the computer play your side too.
* `?speed=4` fast-forwards.

## Night and snow

* `MOODS.night` and `MOODS.winter` in `src/engine.js` are the two new looks. Night is also a choice under Lighting.
* Snow is not new textures: `ctx.setSnow(1)` turns on a shader that lays snow on whatever faces the sky (branches, boulders, stumps) and whitens the ground, so every existing model works in winter. The engine switches it off again when the next game starts.
* `glowPoints()` in `src/games/common.js` draws the fireflies, the stars and the falling snow. `input.pointer` (mouse / touch on the game itself) is what Acorn Toss aims with.
