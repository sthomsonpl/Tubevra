const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
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
};
const { ExtensionStore } = require('../src/extensions/main/extension-store.ts');
const {
  RequestDispatcher,
} = require('../src/extensions/main/request-dispatcher.ts');
const {
  TubervaExtensions,
} = require('../src/extensions/tuberva-extensions.ts');
const registry = [
  {
    id: 'sample',
    name: 'Sample',
    description: 'Test only',
    modes: ['tv'],
    defaultEnabled: false,
    main: true,
    page: false,
  },
];
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tubevra-extensions-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('tubevra-extensions-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
function source() {
  return {
    listener: null,
    onBeforeRequest(listener) {
      this.listener = listener;
    },
  };
}
function request(network) {
  let calls = 0,
    result;
  network.listener(
    { url: 'https://example.com', method: 'GET', resourceType: 'script' },
    (value) => {
      calls++;
      result = value;
    },
  );
  assert.equal(calls, 1);
  return result.cancel;
}
test('first run, concurrent updates, restart and unknown persisted IDs', async (t) => {
  const dir = await directory(t);
  const store = await ExtensionStore.open(dir, registry);
  assert.equal(store.enabled('sample'), false);
  await Promise.all([
    store.update({ id: 'sample', enabled: true }),
    store.update({ id: 'sample', enabled: false }),
  ]);
  assert.equal(
    (await ExtensionStore.open(dir, registry)).enabled('sample'),
    false,
  );
  await fs.writeFile(
    path.join(dir, 'extensions.json'),
    JSON.stringify({ version: 1, enabled: { absent: true } }),
  );
  const reopened = await ExtensionStore.open(dir, registry);
  await reopened.update({ id: 'sample', enabled: true });
  assert.equal(
    JSON.parse(await fs.readFile(path.join(dir, 'extensions.json'))).enabled
      .absent,
    true,
  );
  await assert.rejects(reopened.update({ id: 'absent', enabled: false }));
  await assert.rejects(reopened.update({ id: 'sample', enabled: 1 }));
});
test('corrupt, unsupported and invalid files are preserved', async (t) => {
  const dir = await directory(t),
    file = path.join(dir, 'extensions.json');
  for (const content of [
    '{',
    '{"version":2,"enabled":{}}',
    '{"version":1,"enabled":{"sample":1}}',
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(ExtensionStore.open(dir, registry), /preserved/);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
});
test('dispatcher combines rules, isolates failure and detaches', () => {
  const network = source(),
    errors = [];
  const dispatcher = new RequestDispatcher(network, (id) => errors.push(id));
  dispatcher.register('bad', () => {
    throw new Error('bad rule');
  });
  dispatcher.register('allow', () => 'allow');
  dispatcher.register('block', () => 'block');
  assert.equal(request(network), true);
  assert.deepEqual(errors, ['bad']);
  dispatcher.remove('block');
  assert.equal(request(network), false);
  assert.deepEqual(errors, ['bad']);
  dispatcher.dispose();
  assert.equal(network.listener, null);
});
test('engine serializes toggles and cleans main resources on close', async (t) => {
  const dir = await directory(t),
    network = source(),
    events = [];
  const engine = await TubervaExtensions.open(dir, registry, network, {
    sample: async (context) => {
      events.push('start');
      context.registerRule(() => 'block');
      context.onCleanup(() => {
        events.push('partial');
      });
      return () => {
        events.push('stop');
      };
    },
  });
  await Promise.all([
    engine.update({ id: 'sample', enabled: true }),
    engine.update({ id: 'sample', enabled: false }),
    engine.update({ id: 'sample', enabled: true }),
  ]);
  assert.deepEqual(events, ['start', 'stop', 'partial', 'start']);
  assert.equal(engine.snapshot().items[0].status, 'active');
  assert.equal(request(network), true);
  await engine.dispose();
  assert.deepEqual(events.slice(-2), ['stop', 'partial']);
  await assert.rejects(
    engine.update({ id: 'sample', enabled: true }),
    /closed/,
  );
});
test('partial start and cleanup errors remain visible without rules', async (t) => {
  const dir = await directory(t),
    network = source();
  let cleaned = 0;
  const engine = await TubervaExtensions.open(dir, registry, network, {
    sample: (context) => {
      context.registerRule(() => 'block');
      context.onCleanup(() => {
        cleaned++;
        throw new Error('cleanup failure');
      });
      throw new Error('start failure');
    },
  });
  await engine.update({ id: 'sample', enabled: true });
  const item = engine.snapshot().items[0];
  assert.equal(item.enabled, true);
  assert.equal(item.status, 'error');
  assert.match(item.error, /start failure/);
  assert.match(item.error, /cleanup failure/);
  assert.equal(cleaned, 1);
  assert.equal(request(network), false);
  await engine.update({ id: 'sample', enabled: false });
  assert.equal(engine.snapshot().items[0].status, 'disabled');
  await engine.dispose();
});
test('failed atomic write preserves enabled state and running resources; recovery works', async (t) => {
  const dir = await directory(t),
    network = source();
  let stops = 0;
  const engine = await TubervaExtensions.open(dir, registry, network, {
    sample: (context) => {
      context.registerRule(() => 'block');
      return () => {
        stops++;
      };
    },
  });
  await engine.update({ id: 'sample', enabled: true });
  const file = path.join(dir, 'extensions.json');
  await fs.rename(file, `${file}.saved`);
  await fs.mkdir(file);
  await assert.rejects(engine.update({ id: 'sample', enabled: false }));
  assert.equal(engine.snapshot().items[0].enabled, true);
  assert.equal(request(network), true);
  assert.equal(stops, 0);
  await fs.rmdir(file);
  await fs.rename(`${file}.saved`, file);
  await engine.update({ id: 'sample', enabled: false });
  assert.equal(stops, 1);
  await engine.dispose();
});
test('page requirement never claims active before runtime confirmation', async (t) => {
  const engine = await TubervaExtensions.open(
    await directory(t),
    [{ ...registry[0], defaultEnabled: true, page: true }],
    source(),
    { sample: () => () => {} },
  );
  assert.equal(engine.snapshot().items[0].status, 'starting');
  await engine.dispose();
});

test('network failure reports extension error and releases all main resources', async (t) => {
  let cleaned = 0;
  const network = source();
  const engine = await TubervaExtensions.open(
    await directory(t),
    registry,
    network,
    {
      sample: (context) => {
        context.registerRule(() => {
          throw new Error('network failure');
        });
        context.onCleanup(() => {
          cleaned++;
        });
        return () => {
          cleaned++;
        };
      },
    },
  );
  await engine.update({ id: 'sample', enabled: true });
  assert.equal(request(network), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleaned, 2);
  assert.equal(engine.snapshot().items[0].status, 'error');
  assert.match(engine.snapshot().items[0].error, /network failure/);
  assert.equal(request(network), false);
  await engine.update({ id: 'sample', enabled: false });
  assert.equal(engine.snapshot().items[0].status, 'disabled');
  await engine.dispose();
});

test('cleanup failure still runs remaining cleanups and removes network rules', async (t) => {
  let cleaned = 0;
  const network = source();
  const engine = await TubervaExtensions.open(
    await directory(t),
    registry,
    network,
    {
      sample: (context) => {
        context.registerRule(() => 'block');
        context.onCleanup(() => {
          cleaned++;
        });
        return () => {
          throw new Error('stop failure');
        };
      },
    },
  );
  await engine.update({ id: 'sample', enabled: true });
  await engine.update({ id: 'sample', enabled: false });
  assert.equal(cleaned, 1);
  assert.equal(request(network), false);
  assert.equal(engine.snapshot().items[0].enabled, false);
  assert.match(engine.snapshot().items[0].error, /stop failure/);
  await engine.dispose();
});

test('page reports validate payload and revision and require successful main startup', async (t) => {
  const dir = await directory(t);
  const engine = await TubervaExtensions.open(
    dir,
    [{ ...registry[0], page: true }],
    source(),
    { sample: () => () => {} },
  );
  await engine.update({ id: 'sample', enabled: true });
  const revision = engine.snapshot().revision;
  for (const report of [
    null,
    {},
    { revision, id: 'sample', status: 'unknown', error: null },
    { revision: revision - 1, id: 'sample', status: 'active', error: null },
  ])
    await engine.reportPage(report);
  assert.equal(engine.snapshot().items[0].status, 'starting');
  await engine.reportPage({
    revision,
    id: 'sample',
    status: 'active',
    error: null,
  });
  assert.equal(engine.snapshot().items[0].status, 'active');
  engine.resetPage();
  await engine.reportPage({
    revision,
    id: 'sample',
    status: 'active',
    error: null,
  });
  assert.equal(engine.snapshot().items[0].status, 'starting');
  await engine.dispose();
});
