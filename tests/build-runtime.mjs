import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';
await build({
  configFile: false,
  plugins: [extensionBuildPlugin()],
  build: {
    outDir: 'out/verification/runtime',
    lib: {
      entry: 'tests/electron/runtime-preload.ts',
      formats: ['cjs'],
      fileName: () => 'runtime-preload.cjs',
    },
    rollupOptions: { external: ['electron'] },
  },
});
