import { build } from 'vite';
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
  plugins: [
    {
      name: 'fixture-hooks',
      enforce: 'pre',
      transform(code, id) {
        if (
          !id.replaceAll('\\', '/').endsWith('/src/extensions/hooks/runtime.ts')
        )
          return;
        return code.replace(
          '/* bundled hooks */',
          `sample: () => {
      const target = window as unknown as { fixtureCall?: (n: number) => number };
      target.fixtureCall = (n: number) => n + 7;
      return () => { delete target.fixtureCall; return undefined; };
    }`,
        );
      },
    },
  ],
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
