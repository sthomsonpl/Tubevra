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
  assert.equal(reports.at(-1).status, 'reload-required');
  await runtime.apply(config(2, false));
  assert.equal(stops, 2);
  assert.equal(reports.at(-1).status, 'reload-required');
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
  assert.throws(() => ready(event));
  contents.mainFrame.url = 'https://www.youtube.com/tv';
  assert.throws(() => ready(event, true));
  const state = ready(event);
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
