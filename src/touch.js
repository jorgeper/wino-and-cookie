// On-screen controls for phones and tablets: a thumb stick on the left and action buttons on
// the right. They feed the same input the keyboard does (input.stick / press / release), so the
// games don't know the difference. Switched on for touch screens, or with ?touch in the address.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Keep getting this finger's events even if it slides off the control. */
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } };
const RADIUS = 52;   // how far the knob travels from the middle of the stick, in px
const SPRINT = 0.92; // pushing the stick (nearly) all the way holds Shift: sprint / run

/** What a game gets when it doesn't say otherwise: the stick and one Jump button. */
const DEFAULT_LAYOUT = { stick: true, buttons: [{ code: 'Space', label: 'Jump' }] };

export function createTouchPad(input) {
  const pad = $('pad'), zone = $('stick-zone'), base = $('stick'), knob = $('knob'), buttonsEl = $('pad-buttons');
  const waiting = []; // callbacks for the moment touch controls are switched on
  let enabled = false;
  let layout = null;   // what the current game wants, or null when no game is being played
  let stickId = null, origin = null, sprinting = false;
  const held = new Map(); // button element -> key code it is holding down

  function setStick(x, y) {
    input.stick.x = x; input.stick.y = y;
    const far = Math.hypot(x, y) > SPRINT;
    if (far !== sprinting) { sprinting = far; if (far) input.press('ShiftLeft'); else input.release('ShiftLeft'); }
    knob.style.transform = `translate(${x * RADIUS}px, ${y * RADIUS}px)`;
  }
  function dropStick() {
    stickId = origin = null;
    base.style.left = base.style.top = '';
    base.classList.remove('live');
    setStick(0, 0);
  }
  function moveStick(e) {
    let dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
    setStick(dx / RADIUS, dy / RADIUS);
  }
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    capture(zone, e);
    // The stick jumps to wherever the thumb lands (kept whole inside its corner).
    const r = zone.getBoundingClientRect(), half = base.offsetWidth / 2;
    origin = { x: clamp(e.clientX, r.left + half, r.right - half), y: clamp(e.clientY, r.top + half, r.bottom - half) };
    base.style.left = `${origin.x - r.left}px`;
    base.style.top = `${origin.y - r.top}px`;
    base.classList.add('live');
    moveStick(e);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const liftStick = (e) => { if (e.pointerId === stickId) dropStick(); };
  zone.addEventListener('pointerup', liftStick);
  zone.addEventListener('pointercancel', liftStick);

  function letGo(b) {
    if (!held.has(b)) return;
    input.release(held.get(b));
    held.delete(b);
    b.classList.remove('down');
  }
  function releaseAll() {
    for (const b of [...held.keys()]) letGo(b);
    dropStick();
  }

  function build() {
    releaseAll();
    buttonsEl.innerHTML = '';
    const show = enabled && !!layout;
    pad.hidden = !show;
    if (!show) return;
    zone.hidden = layout.stick === false;
    (layout.buttons ?? []).forEach(({ code, label }, i) => {
      const b = document.createElement('button');
      b.className = `pad-btn b${i}`;
      b.textContent = label;
      b.tabIndex = -1; // never takes the keyboard: Space must stay with the game
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e);
        held.set(b, code);
        b.classList.add('down');
        input.press(code);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, () => letGo(b));
      buttonsEl.appendChild(b);
    });
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    document.body.classList.add('touch');
    build();
    for (const fn of waiting.splice(0)) fn();
  }

  // No long-press menus or pinch-zooming of the page in the middle of a game.
  addEventListener('contextmenu', (e) => { if (enabled && !(e.target instanceof HTMLInputElement)) e.preventDefault(); });
  addEventListener('gesturestart', (e) => e.preventDefault());

  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse || new URLSearchParams(location.search).has('touch')) enable();
  // A laptop with a touch screen: the controls appear the first time the screen is touched.
  else addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enable(); }, { capture: true });

  return {
    get enabled() { return enabled; },
    /** Run `fn` once touch controls are on (straight away if they already are). */
    whenEnabled(fn) { if (enabled) fn(); else waiting.push(fn); },
    /** Show the controls a game asks for (`def.touch`), or pass null to put them away. */
    set(def) {
      layout = def ? { ...DEFAULT_LAYOUT, ...def.touch } : null;
      build();
    },
  };
}
