import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';
import { fixtureCatalog } from './fixtures/extensions/catalog.mjs';
await build({
  configFile: false,
  build: {
    outDir: 'out/verification/hooks',
    lib: {
      entry: 'tests/electron/hooks-preload.ts',
      formats: ['cjs'],
      fileName: () => 'hooks-preload.cjs',
    },
    rollupOptions: { external: ['electron'] },
  },
});

await build({
  configFile: false,
  plugins: [extensionBuildPlugin(fixtureCatalog)],
  build: {
    outDir: 'out/verification/hooks-bootstrap',
    lib: {
      entry: 'tests/electron/hooks-bootstrap-preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: { external: ['electron'] },
  },
});
