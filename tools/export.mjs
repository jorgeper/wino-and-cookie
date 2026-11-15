// Exports every characters/*.blend to public/models/<name>.glb and writes
// public/models/manifest.json, which the game reads at startup.
//
//   npm run export          -> export only .blend files that changed
//   npm run export -- --all -> re-export everything
//
// Also imported by vite.config.js so `npm run dev` re-exports on save.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHAR_DIR = path.join(ROOT, 'characters');
const OUT_DIR = path.join(ROOT, 'public', 'models');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const CONFIG = path.join(CHAR_DIR, 'characters.json');
const PY = path.join(ROOT, 'tools', 'export_blend.py');
const MAX_TEX = process.env.MAX_TEXTURE_SIZE || '2048';

function findBlender() {
  const candidates = [
    process.env.BLENDER_PATH,
    '/Applications/Blender.app/Contents/MacOS/Blender',
    'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
    '/usr/bin/blender',
    '/snap/bin/blender',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || 'blender';
}

const slug = (file) => path.basename(file, '.blend').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function runBlender(blendFile, outFile) {
  return new Promise((resolve, reject) => {
    const args = ['-b', '--factory-startup', '--disable-autoexec', blendFile,
      '--python', PY, '--', outFile, MAX_TEX];
    const p = spawn(findBlender(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('EXPORT_INFO '));
      if (code !== 0 || !line || !fs.existsSync(outFile)) {
        reject(new Error(`Blender export failed for ${path.basename(blendFile)} (exit ${code})\n${out.slice(-2000)}`));
      } else resolve(JSON.parse(line.slice('EXPORT_INFO '.length)));
    });
  });
}

/** Export changed (or all) blends and rewrite the manifest. Returns the manifest. */
export async function exportAll({ force = false, log = console.log } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const blends = fs.readdirSync(CHAR_DIR).filter((f) => f.endsWith('.blend')).sort();
  const prev = readJSON(MANIFEST, { characters: [] });
  const prevById = Object.fromEntries(prev.characters.map((c) => [c.id, c]));
  const config = readJSON(CONFIG, {});
  const characters = [];

  for (const file of blends) {
    const id = slug(file);
    const src = path.join(CHAR_DIR, file);
    const out = path.join(OUT_DIR, `${id}.glb`);
    const srcTime = fs.statSync(src).mtimeMs;
    let info = prevById[id];
    const stale = force || !info || !fs.existsSync(out) || info.sourceMtime !== srcTime;

    if (stale) {
      log(`[export] ${file} -> public/models/${id}.glb ...`);
      const t = Date.now();
      try {
        const meta = await runBlender(src, out);
        info = { ...meta, sourceMtime: srcTime, version: Date.now() };
        log(`[export]   done in ${((Date.now() - t) / 1000).toFixed(1)}s, clips: ${meta.clips.join(', ')}`);
      } catch (err) {
        log(`[export]   ${err.message}`);
        if (!info) continue; // never exported successfully: leave it out
      }
    }
    const overrides = config[id] || {};
    characters.push({
      id,
      source: `characters/${file}`,
      url: `models/${id}.glb?v=${info.version}`,
      name: overrides.name || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      clips: info.clips,
      height: info.height,
      fps: info.fps,
      locomotion: info.locomotion || {},
      sourceMtime: info.sourceMtime,
      version: info.version,
      ...overrides,
    });
  }

  // Remove GLBs whose .blend is gone.
  const keep = new Set(characters.map((c) => `${c.id}.glb`));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.glb') && !keep.has(f)) fs.rmSync(path.join(OUT_DIR, f));
  }

  const manifest = { generated: new Date().toISOString(), characters };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  exportAll({ force: process.argv.includes('--all') })
    .then((m) => console.log(`[export] manifest: ${m.characters.map((c) => c.name).join(', ')}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
