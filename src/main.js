import './style.css';
import { createEngine } from './engine.js';
import { sfx } from './audio.js';
import { initSettings } from './settings.js';
import { createTouchPad } from './touch.js';
import lobby from './games/lobby.js';
import soccer from './games/soccer.js';
import volley from './games/volley.js';
import sumo from './games/sumo.js';
import herd from './games/herd.js';
import toss from './games/toss.js';
import fireflies from './games/fireflies.js';
import snow from './games/snow.js';
import testing from './games/testing.js';

const GAMES = [soccer, volley, sumo, herd, toss, fireflies, snow, testing];
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const auto = params.has('auto'); // ?auto plays the player's side too (handy for watching / testing)

let engine;
let pad; // on-screen controls for touch screens
let playerId;
let active = null; // game definition being played

/** Keep sandbox modes in the address bar, so a reload (after a Blender re-export) comes back to them. */
function setUrl(def) {
  const url = new URL(location.href);
  if (def?.sandbox) url.searchParams.set('game', def.id); else if (GAMES.find((g) => g.id === url.searchParams.get('game'))?.sandbox) url.searchParams.delete('game');
  history.replaceState(null, '', url);
}

/** The on-screen controls are out only while a game is actually being played. */
function syncPad() {
  pad.set(active && !engine.paused && !engine.current?.over ? active : null);
}

function showMenu() {
  active = null;
  syncPad();
  setUrl(null);
  $('menu').hidden = false;
  $('end').hidden = true;
  $('pause').hidden = true;
  engine.hud.show(false);
  engine.start(lobby);
  if (!pad.enabled) $('cards').querySelector('button')?.focus(); // keyboard players start on the first card
}

function play(def) {
  active = def;
  $('menu').hidden = true;
  $('end').hidden = true;
  $('pause').hidden = true;
  engine.hud.show(true);
  setUrl(def);
  engine.start(def, { playerId, auto });
  $('pause-btn').hidden = !!def.sandbox;
  syncPad();
  window.__game = engine.current.game; // for poking at from the console
  document.activeElement?.blur();
}

function setPaused(p) {
  if (!active || active.sandbox || engine.current?.over) return;
  engine.setPaused(p);
  $('pause-keys').innerHTML = active.controls ?? '';
  $('pause').hidden = !p;
  syncPad();
}

function pickCharacter(id) {
  playerId = id;
  try { localStorage.setItem('wino-and-cookie-player', id); } catch { /* private window */ }
  for (const b of document.querySelectorAll('#who button')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
}

async function boot() {
  engine = await createEngine();
  window.__engine = engine;
  initSettings(engine);
  pad = createTouchPad(engine.input);
  // On a touch screen the reminders talk about the buttons on screen, not the keyboard.
  pad.whenEnabled(() => {
    for (const def of GAMES) def.controls = def.touch?.hint ?? '';
    if (active) engine.hud.hint(active.controls);
  });

  // Character picker
  const who = $('who');
  for (const [id, emoji] of [[engine.WINO, '🐧'], [engine.COOKIE, '🦌']]) {
    const b = document.createElement('button');
    b.dataset.id = id;
    b.innerHTML = `${emoji} ${engine.assets[id].entry.name}`;
    b.onclick = () => { pickCharacter(id); sfx.blip(); };
    who.appendChild(b);
  }
  let saved = null;
  try { saved = localStorage.getItem('wino-and-cookie-player'); } catch { /* private window */ }
  pickCharacter(engine.assets[saved] ? saved : engine.WINO);

  // Game cards
  GAMES.forEach((def, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<span class="num">${i + 1}</span><span class="emoji">${def.emoji}</span><h2>${def.title}</h2><p>${def.blurb}</p>${def.controls ? `<p class="keys">${def.controls}</p>` : ''}`;
    b.onclick = () => { sfx.blip(); play(def); };
    $('cards').appendChild(b);
  });

  engine.onFinish((result) => {
    $('end-title').textContent = result.title;
    $('end-text').textContent = result.text;
    syncPad();
    setTimeout(() => { if (active) { $('end').hidden = false; $('again').focus(); } }, 1400);
  });

  $('again').onclick = () => play(active);
  $('to-menu').onclick = showMenu;
  $('back').onclick = showMenu;
  $('resume').onclick = () => setPaused(false);
  $('pause-btn').onclick = (e) => { setPaused(true); e.currentTarget.blur(); };
  $('quit').onclick = showMenu;
  const muteBtn = $('mute');
  const paintMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { sfx.toggleMute(); paintMute(); muteBtn.blur(); };
  paintMute();

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.code === 'KeyM') { sfx.toggleMute(); paintMute(); }
    if (!active) {
      const n = Number(e.key);
      if (n >= 1 && n <= GAMES.length) play(GAMES[n - 1]);
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!engine.paused);
    if (e.code === 'KeyR' && !$('end').hidden) play(active);
  });
  addEventListener('blur', () => { if (!auto) setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !auto) setPaused(true); }); // phone locked, app switched

  $('loading').remove();
  const direct = GAMES.find((g) => g.id === params.get('game'));
  if (direct) play(direct); else showMenu();
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = `Could not start: ${err.message}`;
});
