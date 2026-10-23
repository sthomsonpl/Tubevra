import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';
await build({
  configFile: false,
  plugins: [extensionBuildPlugin()],
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: '"main_window"',
  },
  build: {
    outDir: 'out/verification/adblock',
    lib: {
      entry: 'tests/electron/adblock-main.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: { external: ['electron', /^node:/] },
  },
});
