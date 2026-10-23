// Test-only copy: never modify the production archive or register fixture hooks there.
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { NtExecutable, NtExecutableResource } from 'resedit';
import { extractAll, createPackage, getRawHeader } from '@electron/asar';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw Error(
    'Packaged hook verification currently supports Windows x64 only.',
  );
const root = await mkdtemp(path.join(os.tmpdir(), 'tubevra-packaged-hooks-'));
if (
  path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
  !path.basename(root).startsWith('tubevra-packaged-hooks-')
)
  throw Error('Refusing a test directory outside the temporary root.');
try {
  const appDir = path.join(root, 'app');
  const source = path.join(root, 'source');
  await cp('out/Tubevra-win32-x64', appDir, { recursive: true });
  extractAll(path.join(appDir, 'resources/app.asar'), source);
  const fixture = {
    name: 'packaged-hook-fixture',
    enforce: 'pre',
    transform(code, id) {
      const file = id.replaceAll('\\', '/');
      if (file.endsWith('/src/extensions/registry.ts'))
        return code.replace(
          '[],',
          "[{ id: 'sample', name: 'Packaged hook', description: 'Test only', modes: ['tv'], defaultEnabled: true, main: false, page: false, hooks: true }],",
        );
      if (file.endsWith('/src/main/tv-window.ts'))
        return code.replace(
          '() => notifyExtensions(),',
          "() => notifyExtensions(), ['sample'],",
        );
      if (file.endsWith('/src/extensions/hooks/runtime.ts'))
        return code.replace(
          '/* bundled hooks */',
          `sample: (context) => {
          const target = window as unknown as { fixtureCall?: (n: number) => number };
          target.fixtureCall = (n: number) => n + 7;
          const fail = () => { context.requireReload('Fixture effects need reload.'); context.reportError('Fixture hook failed.'); };
          window.addEventListener('fixture-fail', fail);
          context.onCleanup(() => { window.removeEventListener('fixture-fail', fail); return undefined; });
          return () => { delete target.fixtureCall; return undefined; };
        }`,
        );
    },
  };
  for (const [entry, filename] of [
    ['tests/electron/packaged-hooks-main.ts', 'main.cjs'],
    ['src/preload/tv-preload.ts', 'tv-preload.cjs'],
  ]) {
    await build({
      configFile: false,
      plugins: [fixture],
      define: {
        MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
        MAIN_WINDOW_VITE_NAME: '"main_window"',
      },
      build: {
        emptyOutDir: false,
        outDir: path.join(source, '.vite/build'),
        lib: { entry, formats: ['cjs'], fileName: () => filename },
        rollupOptions: { external: ['electron', /^node:/] },
      },
    });
  }
  await createPackage(source, path.join(appDir, 'resources/app.asar'));
  // Re-seal the test copy with its new ASAR hash; preserve fuses and validation.
  const exePath = path.join(appDir, 'Tubevra.exe');
  const exe = NtExecutable.from(await readFile(exePath));
  const resources = NtExecutableResource.from(exe);
  const integrity = resources.entries.find(
    (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
  );
  if (!integrity) throw Error('Missing packaged ASAR integrity resource.');
  const entries = JSON.parse(Buffer.from(integrity.bin).toString('utf8'));
  const archive = entries.find(
    (entry) => entry.file.replaceAll('\\', '/') === 'resources/app.asar',
  );
  if (!archive) throw Error('Missing app.asar integrity entry.');
  archive.value = createHash('sha256')
    .update(getRawHeader(path.join(appDir, 'resources/app.asar')).headerString)
    .digest('hex');
  integrity.bin = new TextEncoder().encode(JSON.stringify(entries)).buffer;
  resources.outputResource(exe);
  await writeFile(exePath, Buffer.from(exe.generate()));
  const resultPath = path.join(root, 'result.json');
  const profile = path.join(root, 'profile');
  await mkdir(profile);
  const env = {
    ...process.env,
    TUBEVRA_TEST_PROFILE: profile,
    TUBEVRA_TEST_RESULT: resultPath,
    TUBEVRA_TEST_LIVE: process.argv.includes('--live') ? '1' : '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const status = await new Promise((resolve, reject) => {
    const child = spawn(path.join(appDir, 'Tubevra.exe'), [], {
      env,
      windowsHide: true,
      stdio: 'inherit',
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error('Packaged hook test timed out.'));
    }, 60000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  console.log(result);
  if (status !== 0 || !result.passed) throw Error('Packaged hook test failed.');
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
