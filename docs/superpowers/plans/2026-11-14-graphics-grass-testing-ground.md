# Graphics settings, scenery detail, grass, Testing Ground — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-game graphics settings (characters, scenery, grass, light, camera), wind-blown grass, and the three-stuff-demo playground as a fifth mode.

**Architecture:** One settings object (`src/graphics.js`, saved in localStorage) drives everything. The engine renders through a `Graphics` instance ported from the demo; scenery and grass read shared uniforms so changes apply live without rebuilding a level, except grass density/height which rebuild the grass mesh.

**Tech Stack:** three 0.187, Vite 8, three-gpu-pathtracer (photo mode only, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-11-14-graphics-grass-testing-ground-design.md`

## Global Constraints

- No test runner exists; each task is verified by `npm run build` plus a browser check on `http://localhost:5173/`.
- Defaults must reproduce today's look, except grass on.
- Plain `npm run dev` must never require Blender.
- No `.blend1` or `backups/` copied; nothing over 25 MB added.

## Review Focus

- Switching games or returning to the menu with post effects on: composer must keep working and not leak.
- Window resize with composer active.
- Saved settings from an older version (missing keys) must fall back to defaults.
- Settings panel open while playing: Space/arrows must not poke controls (blur after change).
- Grass must not grow on play surfaces, through decals, or inside the sumo ring's drop-away floor.

---

### Task 1: Graphics core + settings gear

**Files:** Create `src/graphics.js`, `src/settings.js`; modify `src/engine.js`, `src/main.js`, `index.html`, `src/style.css`.

**Interfaces — produces:**
- `DEFAULTS`, `loadSettings()`, `saveSettings(s)` in `graphics.js`.
- `class Graphics({renderer, scene, camera, sun, basePixelRatio})` with `settings`, `set(next)`, `resize()`, `render(focusDistance)`, `onChange(fn)`.
- Settings keys: `fabric, fuzz, furLength, sceneryDetail, sceneryStrength, grass, grassDensity, grassHeight, wind, lighting('auto'|'day'|'golden'|'dusk'), shadows, ao, aa, tiltShift, grade`.
- Engine exposes `engine.graphics`; `ctx.setMood` honours a non-auto `lighting` override.
- `ctx.spawn` applies fabric settings; live changes re-apply to current characters.

- [ ] Port graphics.js; wire engine render loop and resize through it.
- [ ] Panel markup + `initSettings(engine)`; ⚙ in menu and HUD corner.
- [ ] Verify: build passes; toggling each setting changes the picture; reload keeps settings; Reset restores.

### Task 2: Scenery detail shader

**Files:** Create `src/scenery-shader.js`; modify `src/forest.js`.

**Interfaces — produces:** `sceneryUniforms = {uDetail, uTime, uWind}`; `applySceneryShader(material)`.

- [ ] Patch scenery materials via `onBeforeCompile`: classify by painted colour (foliage / bark / stone), add pattern, bump, backlight, wind sway (instanced, world-space).
- [ ] Verify: off = identical to before; on = leaves, bark, stone visibly distinct on all three tree types and rocks.

### Task 3: Grass

**Files:** Create `src/grass.js`; modify `src/forest.js`, each `src/games/*.js` that has a play surface.

**Interfaces — produces:** `buildGrass({seed, radius, heightAt(x,z), blocked(x,z), settings})` returning a Mesh with `userData.rebuild(settings)`; `grassUniforms = {uTime, uWind}`. `buildForest` gains `turf: (x,z) => boolean` (short grass there) and adds the grass itself.

- [ ] Instanced tapered blades, per-blade colour/lean, wind in vertex shader, distance fade.
- [ ] Height map: 0 on hard surfaces, turf height on pitches, rising toward the tree ring.
- [ ] Verify in all four games + lobby; frame rate stays smooth at default density.

### Task 4: Testing Ground

**Files:** Create `src/games/testing.js`, `src/photo.js`; modify `src/engine.js` (free-camera hook), `src/main.js`, `index.html`, `src/style.css`, `package.json`.

- [ ] Grid floor, studio lighting presets, click-to-control, pointer-lock look, inspector, skeleton, roster, photo mode (dynamic import).
- [ ] Verify: card 5 / key `5` opens it; walk, jump, switch character, preview clips, photo mode in and out, back to menu cleanly.

### Task 5: Export tooling

**Files:** Copy `characters/*.blend`, `characters/characters.json`, `tools/`; modify `vite.config.js` (new), `package.json`, `.gitignore`, `README.md`.

- [ ] `npm run export` and `npm run dev:blender`; plain `dev` unchanged.
- [ ] Verify sizes; verify `npm run dev` works with no Blender call.
