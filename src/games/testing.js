import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOODS } from '../engine.js';
import { PhotoMode } from '../photo.js';
import { separateCharacters } from '../physics.js';

/*
 * Testing Ground: the white grid room from three-stuff-demo. Not a game: click a stuffy to
 * take control, walk it around, preview every animation clip, look at the skeleton, try the
 * graphics settings, and take path-traced photos.
 */

const $ = (id) => document.getElementById(id);
const LOOK_SENSITIVITY = 0.0022;
const STATE = 'wino-and-cookie-testing';
const ROOM = 'wino-and-cookie-testing-room';
const ROOMS = ['studio', 'warm', 'overcast', 'bedtime'];

/**
 * A big white slab that follows the camera. The grid is computed in world space inside the
 * shader, so the lines stay put while the slab moves: it looks infinite.
 * Fine lines every 1 m, stronger every 5 m, faint 5 m checker, coloured axes at the origin.
 */
function createGround() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGridPos;
        float gridLine(vec2 p, float spacing, float px) {
          vec2 c = p / spacing;
          vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
          return 1.0 - clamp(min(d.x, d.y) / px, 0.0, 1.0);
        }
        float axisLine(float v, float px) {
          return 1.0 - clamp(abs(v) / fwidth(v) / px, 0.0, 1.0);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vGridPos.xz;
          float dist = length(p - cameraPosition.xz);
          float fade = 1.0 - smoothstep(25.0, 90.0, dist);
          vec2 cell = floor(p / 5.0);
          float checker = mod(cell.x + cell.y, 2.0);
          vec3 col = mix(vec3(1.0), vec3(0.94, 0.95, 0.968), checker * fade);
          col = mix(col, vec3(0.70, 0.74, 0.81), gridLine(p, 1.0, 1.2) * 0.7 * fade);
          col = mix(col, vec3(0.48, 0.53, 0.63), gridLine(p, 5.0, 1.8) * 0.85 * fade);
          col = mix(col, vec3(0.93, 0.36, 0.36), axisLine(p.y, 1.6) * fade);   // X axis (red)
          col = mix(col, vec3(0.30, 0.48, 0.95), axisLine(p.x, 1.6) * fade);   // Z axis (blue)
          diffuseColor.rgb *= col;
        }`);
  };
  mat.customProgramCacheKey = () => 'infinite-grid-v1';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** A soft dark patch right under a character, so round plush bottoms don't seem to hover. */
function contactTexture() {
  const size = 128, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(20,24,36,0.62)');
  grad.addColorStop(0.3, 'rgba(20,24,36,0.42)');
  grad.addColorStop(0.6, 'rgba(20,24,36,0.14)');
  grad.addColorStop(1.0, 'rgba(20,24,36,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default {
  id: 'testing',
  title: 'Testing Ground',
  emoji: '🧪',
  blurb: 'Not a game. Walk Wino and Cookie around a blank room and try out animations and graphics.',
  sandbox: true, // no score, no pause screen, no result card
  touch: { buttons: [{ code: 'Space', label: 'Jump' }] }, // shown while a character is selected

  create(ctx) {
    const { root, camera, renderer, input, graphics } = ctx;
    const canvas = renderer.domElement;
    const ui = $('testing');
    const off = []; // undo functions for everything we attach
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };

    ctx.freeCamera = true;
    let room = 'studio';
    try { const r = localStorage.getItem(ROOM); if (ROOMS.includes(r)) room = r; } catch { /* private window */ }
    const applyRoom = () => {
      ctx.setMood(room, room, 0, true);
      ui.dataset.room = room;
      $('tg-room').value = room;
    };
    applyRoom();

    const ground = ctx.own(createGround());
    root.add(ground);

    camera.position.set(0, 2.2, 6.5);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.keys = {}; // arrow keys belong to us, not OrbitControls
    off.push(() => controls.dispose());

    // ------------------------------------------------------------ selection rings
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0x3d6bff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 1;
    ring.visible = false;
    const hoverRing = new THREE.Mesh(ring.geometry, ring.material.clone());
    hoverRing.rotation.x = -Math.PI / 2;
    hoverRing.material.opacity = 0.3;
    hoverRing.visible = false;
    root.add(ctx.own(ring), ctx.own(hoverRing));

    // ------------------------------------------------------------ characters
    // Full size here (the games shrink Wino so matches are fair). A bigger body takes bigger
    // strides and jumps higher, unless the manifest says otherwise.
    const shadowTex = contactTexture();
    const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    off.push(() => { shadowTex.dispose(); shadowGeo.dispose(); });
    const tags = $('tg-tags');
    const characters = ctx.ids.map((id) => {
      const entry = ctx.entryOf(id), scale = entry.scale ?? 1;
      const c = ctx.spawn(id, {
        scale,
        walkSpeed: entry.walkSpeed ?? 1.2 * scale,
        runSpeed: entry.runSpeed ?? 3.0 * scale,
        jumpVelocity: entry.jumpVelocity ?? 6.2 * Math.sqrt(scale),
        jumpStartSpeed: 1.6,
      });
      c.contactShadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
      root.add(c.contactShadow);
      off.push(() => c.contactShadow.material.dispose());
      c.tag = document.createElement('div');
      c.tag.className = 'tg-nametag';
      c.tag.textContent = c.name;
      tags.appendChild(c.tag);
      return c;
    });
    // Line them up side by side with a gap that depends on how wide each one is.
    const gap = 0.8;
    let x = -(characters.reduce((s, c) => s + c.radius * 2, 0) + gap * (characters.length - 1)) / 2;
    for (const c of characters) { c.place(x + c.radius, 0, 0); x += c.radius * 2 + gap; }

    let selected = null, hovered = null, skeletonHelper = null, lastUnlock = 0;
    const mouseLocked = () => document.pointerLockElement === canvas;
    // Touch screens (see touch.js): no mouse to capture; drag orbits, the on-screen stick walks.
    const onTouch = () => document.body.classList.contains('touch');
    const hex = (c) => `#${c.color.getHexString()}`;

    // ------------------------------------------------------------ UI
    const insp = {
      root: $('tg-inspector'), dot: $('tg-dot'), name: $('tg-name'), state: $('tg-state'), clips: $('tg-clips'),
      speed: $('tg-speed'), speedOut: $('tg-speed-out'), skeleton: $('tg-skeleton'), source: $('tg-source'),
    };
    const rosterEl = $('tg-roster'), hintEl = $('tg-hint'), statusEl = $('tg-status');
    const photoBar = $('tg-photo-bar'), photoSamples = $('tg-photo-samples');
    ui.hidden = false;
    rosterEl.innerHTML = '';
    characters.forEach((c, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="tg-dot" style="background:${hex(c)}"></span>${c.name} <kbd>${i + 1}</kbd>`;
      // With no Esc key, tapping the character you already control lets go of it.
      b.onclick = () => { if (onTouch() && selected === c) select(null); else selectAndLook(c); b.blur(); };
      c.rosterButton = b;
      rosterEl.appendChild(b);
    });

    function updateHint() {
      if (!selected) { hintEl.textContent = `${onTouch() ? 'Tap' : 'Click'} a character to take control`; hintEl.classList.remove('hidden'); }
      else if (mouseLocked() || onTouch()) hintEl.classList.add('hidden');
      else { hintEl.textContent = 'Click to look around with the mouse · Esc to release'; hintEl.classList.remove('hidden'); }
    }
    function nudgeHint() {
      hintEl.classList.remove('flash');
      void hintEl.offsetWidth;
      hintEl.classList.add('flash');
    }

    function renderInspector() {
      const c = selected;
      insp.root.hidden = !c;
      if (skeletonHelper) { root.remove(skeletonHelper); skeletonHelper.dispose?.(); skeletonHelper = null; }
      if (!c) return;
      insp.dot.style.background = hex(c);
      insp.name.textContent = c.name;
      insp.source.textContent = c.entry.source ?? '';
      insp.speed.value = c.timeScale;
      insp.speedOut.textContent = `${c.timeScale.toFixed(2)}×`;
      insp.clips.innerHTML = '';
      const roleOf = Object.fromEntries(Object.entries(c.roles).map(([r, n]) => [n, r]));
      for (const clip of c.clips) {
        const b = document.createElement('button');
        b.textContent = clip.name;
        b.title = roleOf[clip.name] ? `Used for: ${roleOf[clip.name]}` : 'Not used by gameplay: preview only';
        b.dataset.clip = clip.name;
        b.onclick = () => { c.preview(clip.name); b.blur(); };
        insp.clips.appendChild(b);
      }
      if (insp.skeleton.checked) {
        skeletonHelper = new THREE.SkeletonHelper(c.model);
        root.add(skeletonHelper);
      }
    }

    function select(c) {
      selected = c;
      for (const ch of characters) {
        ch.rosterButton.classList.toggle('active', ch === c);
        ch.tag.classList.toggle('active', ch === c);
        ch.tag.style.background = ch === c ? hex(ch) : '';
      }
      hintEl.classList.remove('flash');
      ring.visible = !!c;
      document.body.classList.toggle('tg-controlling', !!c); // brings out the on-screen stick
      controls.enablePan = !c;
      if (c) ring.material.color.copy(c.color);
      if (!c && mouseLocked()) document.exitPointerLock();
      renderInspector();
      updateHint();
    }

    // While you control a character the mouse is captured (pointer lock): moving it turns the
    // camera, no button needed. Esc frees the cursor; Esc again releases the character.
    function lockMouse() {
      if (mouseLocked() || !canvas.requestPointerLock || onTouch()) return;
      // Returns a promise in modern browsers; it can reject right after an unlock (browser cooldown).
      try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not allowed right now */ }
    }
    function selectAndLook(c) {
      select(c);
      if (c) lockMouse();
    }

    // The panel folds away under its title, which matters on a phone where it covers the room.
    const side = ui.querySelector('.tg-side');
    side.classList.toggle('collapsed', onTouch() && Math.min(innerWidth, innerHeight) < 600);
    $('tg-title').onclick = () => side.classList.toggle('collapsed');

    insp.speed.oninput = () => {
      if (!selected) return;
      selected.timeScale = parseFloat(insp.speed.value);
      insp.speedOut.textContent = `${selected.timeScale.toFixed(2)}×`;
    };
    insp.speed.onchange = () => insp.speed.blur();
    insp.skeleton.onchange = () => { renderInspector(); insp.skeleton.blur(); };
    $('tg-room').onchange = (e) => {
      room = e.target.value;
      try { localStorage.setItem(ROOM, room); } catch { /* private window */ }
      applyRoom();
      e.target.blur();
    };

    // ------------------------------------------------------------ mouse
    on(document, 'pointerlockchange', () => {
      if (!mouseLocked()) lastUnlock = performance.now();
      // OrbitControls fights pointer lock (it tries to capture the pointer on click), so it's
      // switched off while the mouse is captured; we orbit and zoom ourselves.
      controls.enabled = !mouseLocked();
      hovered = null;
      updateHint();
    });
    const spherical = new THREE.Spherical(), offset = new THREE.Vector3();
    on(document, 'mousemove', (e) => {
      if (!mouseLocked()) return;
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta -= e.movementX * LOOK_SENSITIVITY;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - e.movementY * LOOK_SENSITIVITY, 0.15, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      camera.lookAt(controls.target);
    });
    on(canvas, 'wheel', (e) => {
      if (!mouseLocked()) return; // OrbitControls handles zoom otherwise
      e.preventDefault();
      offset.copy(camera.position).sub(controls.target);
      const len = THREE.MathUtils.clamp(offset.length() * Math.pow(0.95, -e.deltaY / 50), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(len));
    }, { passive: false });

    // Click (not drag) picks a character; clicking anywhere else resumes mouse look.
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let down = null;
    function pick(e) {
      const r = canvas.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(characters.map((c) => c.hitProxy), false)[0]?.object.userData.character ?? null;
    }
    on(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    on(canvas, 'pointerup', (e) => {
      if (!down || e.button !== 0 || photo.active) { down = null; return; }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 500 && !mouseLocked()) {
        const hit = pick(e);
        if (hit) selectAndLook(hit);
        else if (selected) lockMouse();
      }
      down = null;
    });
    on(canvas, 'pointermove', (e) => {
      hovered = e.buttons || mouseLocked() || photo.active ? null : pick(e);
      canvas.style.cursor = hovered ? 'pointer' : '';
    });
    off.push(() => { canvas.style.cursor = ''; });

    // ------------------------------------------------------------ keys
    on(window, 'keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLSelectElement) return;
      // The browser itself uses Esc to free a captured mouse; only release the character on a second Esc.
      if (e.code === 'Escape' && photo.active) { exitPhoto(); return; }
      if (photo.active) return;
      if (e.code === 'Escape' && !mouseLocked() && performance.now() - lastUnlock > 300) select(null);
      if (e.code === 'Tab' && characters.length) {
        const i = characters.indexOf(selected);
        selectAndLook(characters[(i + (e.shiftKey ? -1 : 1) + characters.length) % characters.length]);
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= characters.length) selectAndLook(characters[n - 1]);
      if (!selected && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) nudgeHint();
    });

    // ------------------------------------------------------------ photo mode
    const photo = new PhotoMode({
      renderer, scene: ctx.scene, camera, controls, ground,
      getHidden: () => {
        // click targets are invisible via their material, which the path tracer ignores
        const list = [ring, hoverRing, ...characters.map((c) => c.contactShadow), ...characters.map((c) => c.hitProxy)];
        if (skeletonHelper) list.push(skeletonHelper);
        for (const c of characters) for (const e of c.fabric?.entries || []) list.push(...e.shells);
        return list;
      },
    });
    let saveRequested = false;
    async function enterPhoto() {
      if (mouseLocked()) document.exitPointerLock();
      document.body.classList.add('photo');
      photoBar.hidden = false;
      photoSamples.textContent = '…';
      controls.enabled = true;
      graphics.paused = true; // the path tracer draws to the canvas instead
      try {
        await photo.enter(MOODS[room]);
      } catch (err) {
        console.error(err);
        exitPhoto();
        statusEl.textContent = `Photo mode failed: ${err.message}`;
      }
    }
    function exitPhoto() {
      photo.exit();
      graphics.paused = false;
      document.body.classList.remove('photo');
      photoBar.hidden = true;
    }
    $('tg-photo').onclick = (e) => { e.currentTarget.blur(); enterPhoto(); };
    $('tg-photo-exit').onclick = exitPhoto;
    $('tg-photo-save').onclick = () => { saveRequested = true; };

    // ------------------------------------------------------------ remember where things were
    // The page reloads when a .blend is re-exported (npm run dev:blender); pick up where we left off.
    const remember = () => {
      try {
        sessionStorage.setItem(STATE, JSON.stringify({
          cam: camera.position.toArray(), target: controls.target.toArray(), selected: selected?.id,
          chars: characters.map((c) => ({ id: c.id, p: c.position.toArray(), yaw: c.root.rotation.y, speed: c.timeScale })),
        }));
      } catch { /* private window */ }
    };
    on(window, 'beforeunload', remember);
    try {
      const s = JSON.parse(sessionStorage.getItem(STATE));
      if (s) {
        camera.position.fromArray(s.cam);
        controls.target.fromArray(s.target);
        for (const saved of s.chars || []) {
          const c = characters.find((ch) => ch.id === saved.id);
          if (c) { c.place(saved.p[0], saved.p[2], saved.yaw); c.timeScale = saved.speed ?? 1; }
        }
        select(characters.find((c) => c.id === s.selected) ?? null);
      } else select(null);
    } catch { select(null); }
    camera.lookAt(controls.target);

    // ------------------------------------------------------------ loop
    const focus = new THREE.Vector3(), v = new THREE.Vector3();
    const base = `${characters.length} character${characters.length === 1 ? '' : 's'}`;
    statusEl.textContent = base;

    function placeTags() {
      const w = innerWidth, h = innerHeight;
      for (const c of characters) {
        v.set(c.position.x, c.position.y + c.height + 0.25, c.position.z).project(camera);
        const visible = v.z < 1 && !photo.active;
        c.tag.style.display = visible ? '' : 'none';
        if (visible) c.tag.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
    }

    return {
      get characters() { return characters; },
      get selected() { return selected; },
      select: selectAndLook,
      photo, controls,

      update(dt) {
        if (photo.active) { controls.update(dt); return; } // the world is frozen
        let steer = null;
        if (selected) {
          const m = input.move();
          if (m.x || m.z) {
            // Keys are relative to where the camera is looking.
            const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
            const c = Math.cos(yaw), s = Math.sin(yaw);
            steer = { x: m.x * c + m.z * s, z: -m.x * s + m.z * c, run: input.down('ShiftLeft', 'ShiftRight') };
          }
          if (input.hit('Space')) selected.jump();
        }
        for (const c of characters) c.update(dt, c === selected ? steer : null);
        separateCharacters(characters);
        for (const c of characters) {
          const lift = 1 / (1 + (c.position.y / c.height) * 4); // fades and shrinks as the character leaves the ground
          const size = c.radius * 2.3 * (0.65 + 0.35 * lift);
          c.contactShadow.position.set(c.position.x, 0.002, c.position.z);
          c.contactShadow.scale.set(size, 1, size);
          c.contactShadow.material.opacity = lift;
        }

        if (selected) {
          // Follow, moving the camera with the target so the orbit angle is kept.
          v.copy(selected.position);
          v.y = selected.position.y * 0.5 + selected.height * 0.55; // damp vertical follow during jumps
          v.sub(controls.target).multiplyScalar(1 - Math.exp(-8 * dt));
          controls.target.add(v);
          camera.position.add(v);
        }
        controls.update(dt);
        ctx.focusDistance = camera.position.distanceTo(controls.target);

        // Keep the "infinite" floor and the shadow box centred on what we're looking at.
        focus.copy(selected ? selected.position : controls.target);
        ground.position.set(Math.round(focus.x / 10) * 10, 0, Math.round(focus.z / 10) * 10);
        ctx.setShadowArea(focus.x, focus.z, 10);

        const t = performance.now() / 1000;
        if (selected) {
          ring.position.set(selected.position.x, 0.005, selected.position.z);
          ring.scale.setScalar(selected.radius * 1.35 * (1 + Math.sin(t * 4) * 0.04));
        }
        hoverRing.visible = !!hovered && hovered !== selected;
        if (hoverRing.visible) {
          hoverRing.position.set(hovered.position.x, 0.004, hovered.position.z);
          hoverRing.scale.setScalar(hovered.radius * 1.35);
          hoverRing.material.color.copy(hovered.color);
        }
        if (selected) {
          insp.state.textContent = selected.displayState;
          const playing = selected.current?.getClip().name;
          for (const b of insp.clips.children) b.classList.toggle('playing', b.dataset.clip === playing);
        }
      },

      afterRender() {
        placeTags();
        if (photo.active && photo.ready && !photo.tracer.isCompiling) {
          photoSamples.textContent = photo.render();
          if (saveRequested) { photo.save(); saveRequested = false; }
        }
      },

      dispose() {
        remember();
        exitPhoto();
        photo.dispose();
        if (mouseLocked()) document.exitPointerLock();
        document.body.classList.remove('tg-controlling');
        if (skeletonHelper) { root.remove(skeletonHelper); skeletonHelper.dispose?.(); }
        for (const fn of off) fn();
        tags.innerHTML = '';
        ui.hidden = true;
      },
    };
  },
};
