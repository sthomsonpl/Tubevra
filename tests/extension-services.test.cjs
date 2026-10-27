const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
const {
  TubervaExtensions,
} = require('../src/extensions/tuberva-extensions.ts');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tubevra-services-'));
  const contexts = {};
  const engine = await TubervaExtensions.open(
    dir,
    ['first', 'second', 'unregistered'].map((id) => ({
      id,
      name: id,
      description: '',
      modes: ['tv'],
      defaultEnabled: true,
      main: true,
      page: true,
    })),
    { onBeforeRequest() {} },
    Object.fromEntries(
      ['first', 'second', 'unregistered'].map((id) => [
        id,
        (context) => {
          contexts[id] = context;
          context.registerPageDiagnostics(
            (value) =>
              Object.keys(value).length === 1 && value.playback === 'ready',
          );
          if (id !== 'unregistered') context.registerService({ owner: id });
          context.reportDiagnostics({ availability: 'available' });
          return () => {};
        },
      ]),
    ),
  );
  t.after(async () => {
    await engine.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const report = (id, diagnostics, patch = {}) =>
    engine.reportPage({
      id,
      document: 'document',
      revision: engine.snapshot().revision,
      instance: 'real',
      layer: 'page',
      status: 'active',
      error: null,
      reloadReason: null,
      diagnostics,
      ...patch,
    });
  return { engine, contexts, report };
}

test('services are owned by independent extension instances and revoked on stop', async (t) => {
  const { engine, contexts } = await fixture(t);
  const first = engine.getService('first'),
    second = engine.getService('second');
  assert.deepEqual(first.value, { owner: 'first' });
  assert.deepEqual(second.value, { owner: 'second' });
  await engine.update({ id: 'first', enabled: false });
  assert.equal(first.abort.signal.aborted, true);
  assert.equal(engine.getService('first'), null);
  assert.equal(engine.getService('second'), second);
  contexts.first.reportDiagnostics({ availability: 'stale' });
  assert.equal(engine.snapshot().items[0].diagnostics, undefined);
  assert.throws(() => contexts.first.registerService({}), /rejected/);
  assert.throws(() => contexts.second.registerService({}), /rejected/);
});

test('page diagnostics cannot overwrite main status or authorize an unregistered service', async (t) => {
  const { engine, report } = await fixture(t);
  await report(
    'first',
    { availability: 'forged' },
    { instance: 'fake', reloadReason: 'forged' },
  );
  assert.equal(engine.snapshot().items[0].reloadRequired, false);
  await report('first', { playback: 'ready' });
  assert.deepEqual(engine.snapshot().items[0].diagnostics, {
    main: { availability: 'available' },
    page: { playback: 'ready' },
  });
  await report('unregistered', { playback: 'ready' });
  assert.equal(engine.getService('unregistered'), null);
  await report('second', { playback: 'x'.repeat(101) });
  assert.equal(engine.snapshot().items[1].diagnostics.page, undefined);
  engine.resetPage();
  assert.equal(engine.snapshot().items[0].diagnostics.page, undefined);
  assert.equal(
    engine.snapshot().items[0].diagnostics.main.availability,
    'available',
  );
});
