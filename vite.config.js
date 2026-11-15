import { defineConfig } from 'vite';
import path from 'node:path';

// `npm run dev:blender` watches characters/: saving a .blend (or dropping a new one in)
// re-exports it and reloads the browser. Plain `npm run dev` never touches Blender.
function blenderWatch() {
  return {
    name: 'blender-watch',
    async configureServer(server) {
      const { exportAll, CHAR_DIR } = await import('./tools/export.mjs');
      const log = (m) => server.config.logger.info(m, { timestamp: true });
      await exportAll({ log });
      server.watcher.add(CHAR_DIR);
      let timer = null;
      let running = Promise.resolve();
      const trigger = (file) => {
        const f = path.resolve(file);
        if (!f.startsWith(CHAR_DIR) || !/\.(blend|json)$/.test(f)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          running = running.then(async () => {
            await exportAll({ log });
            server.ws.send({ type: 'full-reload' });
          });
        }, 800); // Blender saves via a temp file + rename; wait for it to settle
      };
      server.watcher.on('add', trigger);
      server.watcher.on('change', trigger);
      server.watcher.on('unlink', trigger);
    },
  };
}

const watching = !!process.env.BLENDER_WATCH;
export default defineConfig({
  plugins: watching ? [blenderWatch()] : [],
  // Don't let Vite's own reload fire on every GLB write; the plugin reloads once when done.
  server: watching ? { watch: { ignored: ['**/public/models/**'] } } : {},
});
