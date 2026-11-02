import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';

// Build the core TV integration with its normal extension infrastructure.
// Cobalt compatibility itself is installed by tv-preload, not the extension catalog.
const output = 'out/verification/cobalt';
for (const [entry, filename] of [
  ['tests/electron/cobalt-main.ts', 'main.cjs'],
  ['src/preload/preload.ts', 'preload.cjs'],
  ['src/preload/ratings-preload.ts', 'ratings-preload.cjs'],
  ['tests/electron/cobalt-preload.ts', 'tv-preload.cjs'],
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
      outDir: `${output}/build`,
      lib: { entry, formats: ['cjs'], fileName: () => filename },
      rollupOptions: { external: ['electron', /^node:/] },
    },
  });
}
await build({
  configFile: false,
  base: './',
  build: { outDir: `${output}/renderer/main_window` },
});
