// Test-only copy: never modify the production archive or register fixture hooks there.
import { build } from 'vite';
import { extensionBuildPlugin } from '../build/extensions.mjs';
import { fixtureCatalog } from './fixtures/extensions/catalog.mjs';
import { createHash } from 'node:crypto';
import { NtExecutable, NtExecutableResource } from 'resedit';
import { extractAll, createPackage, getRawHeader } from '@electron/asar';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { getCurrentFuseWire, FuseState, FuseV1Options } from '@electron/fuses';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw Error(
    'Packaged hook verification currently supports Windows x64 only.',
  );
const ryd = process.argv.includes('--ryd');
const adblock = process.argv.includes('--adblock');
const sponsorblock = process.argv.includes('--sponsorblock');
if ([ryd, adblock, sponsorblock].filter(Boolean).length > 1)
  throw Error('Choose one packaged extension test.');
if ((ryd || adblock || sponsorblock) && process.argv.includes('--live'))
  throw Error('Extension package tests use local data; --live is unsupported.');
const root = await mkdtemp(path.join(os.tmpdir(), 'tubevra-packaged-hooks-'));
if (
  path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
  !path.basename(root).startsWith('tubevra-packaged-hooks-')
)
  throw Error('Refusing a test directory outside the temporary root.');
try {
  const appDir = path.join(root, 'app');
  const source = path.join(root, 'source');
  await cp(
    process.env.TUBEVRA_TEST_PACKAGE ?? 'out/Tubevra-win32-x64',
    appDir,
    { recursive: true },
  );
  extractAll(path.join(appDir, 'resources/app.asar'), source);
  const productionFuses = await getCurrentFuseWire(
    path.join(appDir, 'Tubevra.exe'),
  );
  if (sponsorblock || ryd) {
    // Inspect the untouched production package before replacing its main entry
    // with the local scenario. Keep packaged preloads and renderer unchanged.
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
      assert.equal(
        await readFile(path.join(appDir, 'resources', file), 'utf8'),
        await readFile(file, 'utf8'),
      );
    for (const file of ['main.cjs', 'tv-preload.cjs'])
      assert.match(
        await readFile(path.join(source, '.vite/build', file), 'utf8'),
        ryd ? /return-youtube-dislike/ : /sponsorblock/,
      );
    if (ryd) {
      for (const file of ['preload.cjs', 'ratings-preload.cjs'])
        assert.ok(
          (await readFile(path.join(source, '.vite/build', file))).length,
        );
      const html = await readFile(
        path.join(source, '.vite/renderer/main_window/index.html'),
        'utf8',
      );
      assert.match(html, /assets/);
    }
    const metadata = JSON.parse(
      await readFile(path.join(source, 'package.json'), 'utf8'),
    );
    assert.equal(metadata.main, '.vite/build/main.cjs');
    for (const fuse of [
      FuseV1Options.RunAsNode,
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments,
    ])
      assert.equal(productionFuses[fuse], FuseState.DISABLE);
    for (const fuse of [
      FuseV1Options.EnableCookieEncryption,
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      FuseV1Options.OnlyLoadAppFromAsar,
    ])
      assert.equal(productionFuses[fuse], FuseState.ENABLE);
    console.log(
      'Production package: extension bundles, fuses and distribution notices verified.',
    );
  }
  for (const [entry, filename] of [
    [
      ryd
        ? 'tests/electron/ryd-main.ts'
        : sponsorblock
          ? 'tests/electron/sponsorblock-playback-main.ts'
          : adblock
            ? 'tests/electron/adblock-main.ts'
            : 'tests/electron/packaged-hooks-main.ts',
      'main.cjs',
    ],
    ['src/preload/tv-preload.ts', 'tv-preload.cjs'],
  ]) {
    if ((ryd || adblock || sponsorblock) && filename === 'tv-preload.cjs')
      continue;
    await build({
      configFile: false,
      plugins: [
        extensionBuildPlugin(
          ryd || adblock || sponsorblock ? undefined : fixtureCatalog,
        ),
      ],
      define: {
        MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
        MAIN_WINDOW_VITE_NAME: '"main_window"',
      },
      build: {
        emptyOutDir: false,
        minify: false,
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
  assert.deepEqual(await getCurrentFuseWire(exePath), productionFuses);
  const resultPath = path.join(root, 'result.json');
  const profile = path.join(root, 'profile');
  await mkdir(profile);
  const env = {
    ...process.env,
    TUBEVRA_TEST_PACKAGED: '1',
    TUBEVRA_TEST_PROFILE: profile,
    TUBEVRA_TEST_RESULT: resultPath,
    TUBEVRA_TEST_LIVE: process.argv.includes('--live') ? '1' : '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const status = await new Promise((resolve, reject) => {
    const child = spawn(path.join(appDir, 'Tubevra.exe'), [], {
      env,
      // Native-view RYD checks require a normally painted GUI from startup.
      windowsHide: !ryd,
      stdio: 'inherit',
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error('Packaged hook test timed out.'));
    }, 90000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  const result = JSON.parse(
    await readFile(resultPath, 'utf8').catch(() => {
      throw Error(
        'Packaged test produced no result (exit ' +
          status +
          '). See scenario error above.',
      );
    }),
  );
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
