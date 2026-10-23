import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';
for (const [entry, filename] of [
  ['tests/electron/adblock-main.ts', 'main.cjs'],
  ['src/preload/preload.ts', 'preload.cjs'],
  ['src/preload/tv-preload.ts', 'tv-preload.cjs'],
]) {
  await build({
    configFile: false,
    plugins: [extensionBuildPlugin()],
    define: {
      MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
      MAIN_WINDOW_VITE_NAME: '"main_window"',
    },
    build: {
      emptyOutDir: filename === 'main.cjs',
      outDir: 'out/verification/adblock/build',
      lib: { entry, formats: ['cjs'], fileName: () => filename },
      rollupOptions: { external: ['electron', /^node:/] },
    },
  });
}
await build({
  configFile: false,
  base: './',
  build: {
    outDir: 'out/verification/adblock/renderer/main_window',
  },
});
