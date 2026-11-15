# Graphics settings, scenery detail, grass, and Testing Ground

## Intent

Jorge wants to control how good the game looks from inside the game, and to retire
`~/throwaway/three-stuff-demo` by moving everything it does into this repo.

## Goals

- A settings gear that carries over the demo's graphics panel.
- Separate controls for how Wino and Cookie look (fabric, fuzz) and how scenery looks.
- Scenery gets shaders suited to what each thing is (leaves, bark, stone), not fluff.
- Procedural grass with wind between the scenery; short on play surfaces, taller near trees.
- A "Testing Ground" mode: the demo's white grid room.
- The Blender export tooling moves here so the demo can be deleted.

## Non-goals

- No gameplay changes to the four games.
- No new scenery models.

## Anti-goals

- With every setting at its default, the four games must not look worse or run slower
  than today (grass is the one thing on by default).

## Approaches

1. **Port the demo's `Graphics` class and extend the settings object** (picked). The game
   already shares `fabric.js` with the demo; one settings object drives characters,
   scenery, grass and post effects. Least new machinery.
2. Keep the demo as a separate page inside this repo (second Vite entry). Rejected: two
   render setups to keep in sync, and settings would not reach the games.
3. Per-game quality presets instead of individual settings. Rejected: Jorge asked for the
   individual controls.

## Design

- `src/graphics.js`: ported from the demo. Owns settings (saved in localStorage), shadows,
  anti-aliasing, the post-effect composer. Engine renders through it.
- `src/settings.js` + markup: ⚙ button (menu and HUD) opening a panel with sections
  Wino & Cookie / Scenery / Grass / Light & shadow / Camera, and Reset.
- Characters: `ctx.spawn` applies `{fabric, fuzz, furLength}` from settings; changes apply
  live to existing characters. Default fabric on, fuzz off (today's look).
- Scenery detail (`src/scenery-shader.js`): patches the scenery `MeshStandardMaterial`.
  Classifies each pixel by painted colour: green = foliage, brown = bark, grey = stone.
  Foliage gets a leaf-clump pattern, backlit glow and wind sway; bark gets vertical
  grooves with a bump; stone gets speckle and cracks. Settings: on/off, strength.
- Grass (`src/grass.js`): instanced blades, wind in the vertex shader. `buildForest` takes
  a `grassHeight(x, z)` function from each game (0 = none, small = turf) and grows taller
  toward the tree ring. Settings: on/off, density, height, wind.
- Lighting setting: Auto (the game's own mood) / Day / Golden / Dusk.
- Testing Ground (`src/games/testing.js`, `src/world-grid.js`, `src/photo.js`): grid floor,
  click-to-control, mouse look, animation inspector, skeleton view, photo mode. Fifth card.
- Export tooling: `characters/`, `tools/` copied in; export is opt-in (`npm run export`,
  `npm run dev:blender` for the watcher) so plain `npm run dev` never needs Blender.
  `.blend1` and `backups/` are not copied.

## Left to the builder

Shader constants, panel styling, exact default values.
