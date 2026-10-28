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

test('Adblock registration preserves existing preferences and persists explicit disable', async (t) => {
  const {
    extensionRegistry,
    hookManifest,
  } = require('../src/extensions/registry.ts');
  const dir = await directory(t);
  await fs.writeFile(
    path.join(dir, 'extensions.json'),
    JSON.stringify({
      version: 1,
      enabled: { legacy: false },
    }),
  );
  const engine = await TubervaExtensions.open(
    dir,
    extensionRegistry,
    source(),
    {},
    () => {},
    hookManifest,
  );
  t.after(() => engine.dispose());
  const item = engine.snapshot().items.find((item) => item.id === 'adblock');
  assert.equal(item.enabled, true);
  assert.equal(item.name, 'Adblock');
  assert.deepEqual(item.modes, ['tv']);
  assert.equal(item.hooks, true);
  assert.equal(item.main, false);
  assert.equal(item.page, false);
  assert.deepEqual(hookManifest, ['adblock']);
  const sponsor = engine
    .snapshot()
    .items.find((item) => item.id === 'sponsorblock');
  assert.equal(sponsor.enabled, false);
  assert.equal(sponsor.defaultEnabled, false);
  assert.deepEqual(sponsor.modes, ['tv']);
  assert.equal(sponsor.main, true);
  assert.equal(sponsor.page, true);
  assert.equal(sponsor.hooks, false);
  const ryd = engine
    .snapshot()
    .items.find((item) => item.id === 'return-youtube-dislike');
  assert.equal(ryd.enabled, false);
  assert.equal(ryd.defaultEnabled, false);
  assert.deepEqual(ryd.modes, ['tv']);
  assert.equal(ryd.main, true);
  assert.equal(ryd.page, true);
  assert.equal(ryd.hooks, false);
  await engine.update({ id: 'adblock', enabled: false });
  const reopened = await ExtensionStore.open(dir, extensionRegistry);
  assert.equal(reopened.enabled('adblock'), false);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, 'extensions.json'), 'utf8')),
    { version: 1, enabled: { legacy: false, adblock: false } },
  );
});
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
test('hook bootstrap reads only committed settings during a pending save', async (t) => {
  for (const fail of [false, true]) {
    await t.test(fail ? 'failed save' : 'successful save', async (t) => {
      const { EventEmitter } = require('node:events');
      const { connectPage } = require('../src/extensions/main/page-bridge.ts');
      const { PAGE_IPC } = require('../src/extensions/page/channels.ts');
      const dir = await directory(t);
      const handlers = new Map();
      const ipc = {
        on: (name, fn) => handlers.set(name, fn),
        handle: (name, fn) => handlers.set(name, fn),
        removeListener: (name) => handlers.delete(name),
        removeHandler: (name) => handlers.delete(name),
      };
      const published = [];
      const contents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'https://www.youtube.com/tv' },
        isDestroyed: () => false,
        send: (_channel, value) => published.push(value),
      });
      let bridge;
      const engine = await TubervaExtensions.open(
        dir,
        [{ ...registry[0], main: false, hooks: true }],
        source(),
        {},
        () => bridge?.publish(),
        ['sample'],
      );
      bridge = connectPage(ipc, contents, engine);
      t.after(async () => {
        bridge.dispose();
        await engine.dispose();
      });
      const read = () => {
        const event = { sender: contents, senderFrame: contents.mainFrame };
        handlers.get(PAGE_IPC.bootstrap)(event);
        assert.equal(event.returnValue.ok, true);
        return event.returnValue.value;
      };
      const initial = read();
      let releaseSave, saving;
      const gate = new Promise((resolve) => {
        releaseSave = resolve;
      });
      const entered = new Promise((resolve) => {
        saving = resolve;
      });
      // Pause the real store at its persistence boundary; do not delay bootstrap.
      const save = engine.store.save.bind(engine.store);
      engine.store.save = async (next) => {
        saving();
        await gate;
        if (fail) throw Error('fixture write rejected');
        await save(next);
      };
      const update = engine.update({ id: 'sample', enabled: true });
      const result = fail
        ? assert.rejects(update, /fixture write rejected/)
        : update;
      await entered;
      assert.deepEqual(read(), initial);
      assert.equal(published.length, 0);
      releaseSave();
      await result;
      const committed = read();
      assert.equal(committed.document, initial.document);
      assert.equal(committed.hooks[0].enabled, !fail);
      assert.equal(committed.revision, initial.revision + (fail ? 0 : 1));
      const handshake = handlers.get(PAGE_IPC.ready)({
        sender: contents,
        senderFrame: contents.mainFrame,
      });
      assert.deepEqual(handshake, committed);
      if (fail) assert.equal(published.length, 0);
      else assert.deepEqual(published.at(-1), committed);
      assert.equal(
        (
          await ExtensionStore.open(dir, [
            { ...registry[0], main: false, hooks: true },
          ])
        ).enabled('sample'),
        !fail,
      );
    });
  }
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
    layer: 'page',
    instance: '1',
    document: 'doc',
    reloadReason: null,
    revision,
    id: 'sample',
    status: 'active',
    error: null,
  });
  assert.equal(engine.snapshot().items[0].status, 'active');
  engine.resetPage();
  await engine.reportPage({
    layer: 'page',
    instance: '1',
    document: 'doc',
    reloadReason: null,
    revision,
    id: 'sample',
    status: 'active',
    error: null,
  });
  assert.equal(engine.snapshot().items[0].status, 'starting');
  await engine.dispose();
});

test('hook manifests preserve package separation and reject missing or invalid implementations', async (t) => {
  const {
    validateHookManifest,
    validateHookImplementations,
    validateHookInstallation,
  } = require('../src/extensions/hooks/validation.ts');
  const hooks = [
    { ...registry[0], main: false, hooks: true, defaultEnabled: true },
  ];
  validateHookManifest(hooks, ['sample']);
  validateHookImplementations(hooks, { sample: () => () => undefined });
  assert.throws(() => validateHookManifest(hooks, []), /manifest/);
  assert.throws(
    () => validateHookManifest(hooks, ['sample', 'sample']),
    /manifest/,
  );
  assert.throws(
    () => validateHookImplementations(hooks, { sample: 1 }),
    /implementation/,
  );
  assert.throws(
    () => validateHookInstallation(Promise.resolve(() => undefined)),
    /synchronously/,
  );
  assert.throws(() => validateHookInstallation(undefined), /synchronously/);
  validateHookInstallation(() => undefined);
  const dir = await directory(t);
  await assert.rejects(
    TubervaExtensions.open(dir, hooks, source(), {}),
    /manifest/,
  );
  const engine = await TubervaExtensions.open(
    dir,
    hooks,
    source(),
    {},
    () => {},
    ['sample'],
  );
  t.after(() => engine.dispose());
  assert.equal(engine.snapshot().items[0].status, 'starting');
});

test('all seven layer combinations require every confirmation and coordinate hook failure', async (t) => {
  for (let mask = 1; mask < 8; mask++) {
    const metadata = {
      ...registry[0],
      defaultEnabled: true,
      main: !!(mask & 1),
      page: !!(mask & 2),
      hooks: !!(mask & 4),
    };
    let released = 0;
    const engine = await TubervaExtensions.open(
      await directory(t),
      [metadata],
      source(),
      {
        sample: () => () => {
          released++;
        },
      },
      () => {},
      metadata.hooks ? ['sample'] : [],
    );
    const report = (layer, status = 'active', extra = {}) => ({
      document: 'doc',
      revision: engine.snapshot().revision,
      id: 'sample',
      instance: '1',
      layer,
      status,
      error: null,
      reloadReason: null,
      ...extra,
    });
    if (metadata.page || metadata.hooks)
      assert.equal(engine.snapshot().items[0].status, 'starting');
    if (metadata.page) await engine.reportPage(report('page'));
    if (metadata.hooks) {
      assert.equal(engine.snapshot().items[0].status, 'starting');
      await engine.reportHook(report('hooks'));
    }
    assert.equal(engine.snapshot().items[0].status, 'active');
    if (metadata.hooks) {
      await engine.reportHook(
        report('hooks', 'error', {
          error: 'callback failed',
          reloadReason: 'irreversible effect',
        }),
      );
      assert.equal(engine.snapshot().items[0].status, 'error');
      assert.equal(engine.snapshot().items[0].reloadRequired, true);
      if (metadata.main) assert.equal(released, 1);
      await engine.update({ id: 'sample', enabled: false });
      assert.equal(engine.snapshot().items[0].reloadRequired, true);
    }
    await engine.dispose();
  }
});

test('coordinator ignores old instances and preserves simultaneous failure and reload', async (t) => {
  const engine = await TubervaExtensions.open(
    await directory(t),
    [{ ...registry[0], main: false, hooks: true, defaultEnabled: true }],
    source(),
    {},
    () => {},
    ['sample'],
  );
  const report = {
    layer: 'hooks',
    document: 'doc',
    instance: 'current',
    revision: engine.snapshot().revision,
    id: 'sample',
    status: 'active',
    error: null,
    reloadReason: null,
  };
  await engine.reportHook(report);
  await engine.reportHook({
    ...report,
    instance: 'old',
    status: 'error',
    error: 'stale',
  });
  assert.equal(engine.snapshot().items[0].status, 'active');
  await engine.reportHook({
    ...report,
    status: 'error',
    error: 'current failure',
    reloadReason: 'irreversible',
  });
  assert.equal(engine.snapshot().items[0].status, 'error');
  assert.equal(engine.snapshot().items[0].reloadRequired, true);
  await engine.reportHook(report);
  assert.equal(engine.snapshot().items[0].status, 'error');
  await engine.dispose();
});
