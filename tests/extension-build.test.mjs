import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'vite';
import {
  buildHookEntry,
  extensionBuildPlugin,
  validateCatalog,
} from '../build/extensions.mjs';
import { fixtureCatalog } from './fixtures/extensions/catalog.mjs';
function entry(source, globals = {}) {
  const origin = vm.createContext({ AbortController, ...globals });
  vm.runInContext(source.replace('export function', 'function'), origin);
  const serialized = vm.runInContext('hookEntry.toString()', origin);
  return vm.runInNewContext('(' + serialized + ')', {
    AbortController,
    ...globals,
  });
}
test('empty catalog serializes without closures', async () => {
  const control = entry(await buildHookEntry([]))({
    document: 'empty',
    revision: 0,
    items: [],
    hooks: [],
  });
  assert.equal(control.drain().length, 0);
  control.dispose();
});
test('folder module and imported helpers survive serialization and cleanup', async () => {
  const window = { addEventListener() {}, removeEventListener() {} };
  const dependencies = new Set();
  const start = entry(
    await buildHookEntry(fixtureCatalog, (id) => dependencies.add(id)),
    { window },
  );
  const control = start({
    document: 'sample',
    revision: 0,
    items: [],
    hooks: [{ id: 'sample', enabled: true }],
  });
  assert.equal(window.fixtureCall(5), 12);
  assert.equal(control.drain().at(-1).status, 'active');
  assert.ok([...dependencies].some((id) => id.endsWith('/sample/value.ts')));
  control.dispose();
  assert.equal(window.fixtureCall, undefined);
});
test('catalog derives metadata, manifests and all layer maps without main importing hooks', async () => {
  const catalog = fixtureCatalog.map((item) => ({
    ...item,
    modules: {
      ...item.modules,
      main: '../../tests/fixtures/extensions/sample/main.ts',
      page: '../../tests/fixtures/extensions/sample/page.ts',
    },
  }));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [extensionBuildPlugin(catalog)],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/fixtures/extensions/layers.ts',
        formats: ['iife'],
        name: 'Layers',
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (item) => item.output,
  );
  const layers = vm.runInNewContext(output[0].code + ';Layers');
  assert.deepEqual(Array.from(layers.hookManifest), ['sample']);
  assert.deepEqual(Object.keys(layers.mainStarts), ['sample']);
  assert.deepEqual(Object.keys(layers.pageStarts), ['sample']);
  assert.equal(layers.extensionRegistry[0].hooks, true);
  assert.equal(layers.extensionRegistry[0].main, true);
  assert.equal(layers.extensionRegistry[0].page, true);
  assert.equal(output[0].code.includes('fixtureCall'), false);
});
test('invalid declarations and forbidden hook dependencies fail the build', async () => {
  assert.throws(
    () => validateCatalog([...fixtureCatalog, ...fixtureCatalog]),
    /declaration/,
  );
  assert.throws(
    () =>
      validateCatalog([
        { ...fixtureCatalog[0], modules: { remote: './unknown.ts' } },
      ]),
    /module/,
  );
  assert.throws(
    () =>
      validateCatalog([
        { ...fixtureCatalog[0], modules: { hooks: '../../../../outside.ts' } },
      ]),
    /outside/,
  );
  await assert.rejects(
    buildHookEntry([
      {
        ...fixtureCatalog[0],
        modules: {
          hooks: '../../tests/fixtures/extensions/sample/forbidden.ts',
        },
      },
    ]),
    /External hook dependency/,
  );
  await assert.rejects(
    buildHookEntry([
      { ...fixtureCatalog[0], modules: { hooks: './missing.ts' } },
    ]),
  );
});
