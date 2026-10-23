import { build } from 'vite';
await build({
  configFile: false,
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
