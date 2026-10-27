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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PageRuntime } = require('../src/extensions/page/runtime.ts');
const config = (revision, enabled = true, document = 'doc') => ({
  document,
  revision,
  items: [{ id: 'sample', enabled }],
});
test('runtime deduplicates, preserves reload requirement and cleans resources', async () => {
  let starts = 0,
    stops = 0;
  const reports = [];
  const runtime = new PageRuntime(
    'doc',
    {},
    {
      sample: (ctx) => {
        starts++;
        ctx.onCleanup(() => stops++);
        ctx.requireReload();
        return () => stops++;
      },
    },
    (report) => reports.push(report),
  );
  await runtime.apply(config(0));
  await runtime.apply(config(0));
  await runtime.apply(config(1));
  assert.equal(starts, 1);
  assert.equal(
    reports.at(-1).reloadReason,
    'Page effects require a new document.',
  );
  await runtime.apply(config(2, false));
  assert.equal(stops, 2);
  assert.equal(
    reports.at(-1).reloadReason,
    'Page effects require a new document.',
  );
  await runtime.dispose();
});
test('runtime ignores stale documents and revisions; partial start cleanup survives errors', async () => {
  let cleanups = 0;
  const reports = [];
  const runtime = new PageRuntime(
    'doc',
    {},
    {
      sample: (ctx) => {
        ctx.onCleanup(() => {
          cleanups++;
          throw Error('cleanup');
        });
        ctx.onCleanup(() => cleanups++);
        throw Error('start');
      },
    },
    (report) => reports.push(report),
  );
  await runtime.apply(config(0, true, 'old'));
  assert.equal(reports.length, 0);
  await runtime.apply(config(1));
  assert.equal(cleanups, 2);
  assert.match(reports.at(-1).error, /start.*\n.*cleanup/);
  await runtime.apply(config(0));
  assert.equal(cleanups, 2);
  await runtime.dispose();
});
test('rapid disable/enable cancels old start without leaking its cleanup', async () => {
  let finish,
    starts = 0,
    cleanups = 0;
  const runtime = new PageRuntime(
    'doc',
    {},
    {
      sample: async () => {
        starts++;
        if (starts === 1)
          await new Promise((resolve) => {
            finish = resolve;
          });
        return () => cleanups++;
      },
    },
    () => {},
  );
  const first = runtime.apply(config(0));
  await Promise.resolve();
  const off = runtime.apply(config(1, false));
  const on = runtime.apply(config(2));
  finish();
  await Promise.all([first, off, on]);
  assert.equal(starts, 2);
  assert.equal(cleanups, 1);
  await runtime.dispose();
  assert.equal(cleanups, 2);
});

test('runtime IPC rejects foreign senders, frames, URLs, documents and invalid arity', async () => {
  const { EventEmitter } = require('node:events');
  const { connectPage } = require('../src/extensions/main/page-bridge.ts');
  const { PAGE_IPC } = require('../src/extensions/page/channels.ts');
  const handlers = new Map();
  const ipc = {
    on: (name, fn) => handlers.set(name, fn),
    removeListener: (name) => handlers.delete(name),
    handle: (name, fn) => handlers.set(name, fn),
    removeHandler: (name) => handlers.delete(name),
  };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'https://www.youtube.com/tv' },
    isDestroyed: () => false,
    send: () => {},
  });
  let reports = 0,
    resets = 0;
  const engine = {
    onAuthorityChange: () => () => {},
    getService: () => null,
    snapshot: () => ({ revision: 0, items: [] }),
    reportPage: () => reports++,
    resetPage: () => resets++,
  };
  const bridge = connectPage(ipc, contents, engine);
  const ready = handlers.get(PAGE_IPC.ready),
    report = handlers.get(PAGE_IPC.report);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.throws(() => ready({ ...event, sender: {} }));
  assert.throws(() =>
    ready({ ...event, senderFrame: { url: contents.mainFrame.url } }),
  );
  contents.mainFrame.url = 'https://evil.test/tv';
  const invalidOrigin = { ...event };
  handlers.get(PAGE_IPC.bootstrap)(invalidOrigin);
  assert.equal(invalidOrigin.returnValue.ok, false);
  const invalidFrame = {
    ...event,
    senderFrame: { url: 'https://www.youtube.com/tv' },
  };
  handlers.get(PAGE_IPC.bootstrap)(invalidFrame);
  assert.equal(invalidFrame.returnValue.ok, false);
  assert.throws(() => ready(event));
  contents.mainFrame.url = 'https://www.youtube.com/tv';
  assert.throws(() => ready(event, true));
  const bootstrap = handlers.get(PAGE_IPC.bootstrap);
  const rejected = { ...event, sender: {} };
  bootstrap(rejected);
  assert.equal(rejected.returnValue.ok, false);
  bootstrap(event, 'invalid');
  assert.equal(event.returnValue.ok, false);
  bootstrap(event);
  assert.equal(event.returnValue.ok, true);
  const state = ready(event);
  assert.equal(state.document, event.returnValue.value.document);
  report(event, { document: 'old' });
  report(event, { document: state.document }, true);
  report({ ...event, sender: {} }, { document: state.document });
  assert.equal(reports, 0);
  report(event, { document: state.document });
  assert.equal(reports, 1);
  contents.emit(
    'did-start-navigation',
    {},
    'https://www.youtube.com/tv',
    false,
    true,
  );
  report(event, { document: state.document });
  assert.equal(reports, 1);
  assert.equal(resets, 1);
  assert.notEqual(ready(event).document, state.document);
  bridge.dispose();
  assert.equal(handlers.size, 0);
});

test('lifecycle deadline releases late resources and observes rejected work', async () => {
  const { deadline } = require('../src/extensions/lifecycle.ts');
  let complete,
    released = 0;
  const operation = deadline(
    new Promise((resolve) => {
      complete = resolve;
    }),
    1,
    (cleanup) => cleanup(),
  );
  await assert.rejects(operation, /timed out/);
  complete(() => {
    released++;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1);
  await assert.rejects(
    deadline(Promise.reject(Error('original')), 100),
    /original/,
  );
});

test('bridge watchdog reports missing confirmation and bounds diagnostic ingress', (t) => {
  const { EventEmitter } = require('node:events');
  const { connectPage } = require('../src/extensions/main/page-bridge.ts');
  const { PAGE_IPC } = require('../src/extensions/page/channels.ts');
  let tick,
    now = 1000,
    count = 0;
  t.mock.method(global, 'setInterval', (callback) => {
    tick = callback;
    return { unref() {} };
  });
  t.mock.method(global, 'clearInterval', () => {});
  t.mock.method(Date, 'now', () => now);
  const handlers = new Map();
  const ipc = {
    on: (key, fn) => handlers.set(key, fn),
    handle: (key, fn) => handlers.set(key, fn),
    removeListener: (key) => handlers.delete(key),
    removeHandler: (key) => handlers.delete(key),
  };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'https://www.youtube.com/tv' },
    isDestroyed: () => false,
    send() {},
  });
  const reports = [];
  const engine = {
    onAuthorityChange: () => () => {},
    getService: () => null,
    snapshot: () => ({
      revision: 1,
      items: [
        {
          id: 'sample',
          status: 'starting',
          hooks: true,
          layers: { hooks: 'starting' },
        },
      ],
    }),
    reportHook: (report) => {
      reports.push(report);
      count++;
    },
  };
  const bridge = connectPage(ipc, contents, engine);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  handlers.get(PAGE_IPC.bootstrap)(event);
  tick();
  now += 10001;
  tick();
  assert.match(reports[0].error, /timed out/);
  assert.equal(reports[0].document, event.returnValue.value.document);
  count = 0;
  for (let n = 0; n < 405; n++)
    handlers.get(PAGE_IPC.hooksReport)(event, {
      document: event.returnValue.value.document,
    });
  assert.equal(count, 400);
  bridge.dispose();
  assert.equal(handlers.size, 0);
});
