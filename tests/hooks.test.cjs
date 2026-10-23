const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function runtime(start) {
  const code = fs
    .readFileSync('src/extensions/hooks/runtime.ts', 'utf8')
    .replace('/* bundled hooks */', 'sample: globalThis.fixtureStart');
  const module = { exports: {} };
  globalThis.fixtureStart = start;
  new Function(
    'exports',
    ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  )(module.exports);
  return module.exports.hookEntry;
}
const config = (revision, enabled = true, document = 'doc') => ({
  document,
  revision,
  items: [],
  hooks: [{ id: 'sample', enabled }],
});
test('hooks install once, reject stale configurations, defer re-enable and clean synchronously', () => {
  let starts = 0,
    stops = 0;
  const entry = runtime(() => {
    starts++;
    return () => {
      stops++;
    };
  });
  const control = entry(config(0));
  control.apply(config(1));
  control.apply(config(0, false));
  control.apply(config(2, false, 'old'));
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  control.apply(config(2, false));
  assert.equal(stops, 1);
  control.apply(config(3));
  assert.equal(starts, 1);
  assert.match(control.drain().at(-1).reloadReason, /new document/);
  control.dispose();
  control.dispose();
  assert.equal(stops, 1);
  const next = entry(config(4));
  assert.equal(starts, 2);
  next.dispose();
  delete globalThis.fixtureStart;
});
test('disabled bootstrap defers activation; invalid async installation cleans partial resources', () => {
  let cleanups = 0;
  const entry = runtime((ctx) => {
    ctx.onCleanup(() => {
      cleanups++;
    });
    return Promise.resolve(() => {});
  });
  const disabled = entry(config(0, false));
  disabled.apply(config(1));
  assert.match(disabled.drain().at(-1).reloadReason, /new document/);
  const failed = entry(config(0));
  assert.equal(cleanups, 1);
  assert.equal(failed.drain().at(-1).status, 'error');
  delete globalThis.fixtureStart;
});

test('bootstrap reconciles committed updates while the ready handshake is pending', async (t) => {
  for (const readyRevision of [0, 3]) {
    await t.test(`handshake revision ${readyRevision}`, async () => {
      const { EventEmitter } = require('node:events');
      const vm = require('node:vm');
      const ipc = new EventEmitter();
      const reports = [];
      let resolveReady,
        hookStarts = 0,
        hookStops = 0,
        pageStarts = 0;
      const entry = runtime(() => {
        hookStarts++;
        return () => {
          hookStops++;
        };
      });
      const state = (revision, enabled) => ({
        ...config(revision, enabled),
        items: [{ id: 'sample', enabled }],
      });
      ipc.sendSync = () => ({ ok: true, value: state(0, true) });
      ipc.send = (_channel, report) => reports.push(report);
      ipc.invoke = (channel) =>
        channel === 'tubevra:page:ready'
          ? new Promise((resolve) => {
              resolveReady = resolve;
            })
          : Promise.resolve();
      const listeners = new Map();
      const modules = new Map();
      const load = (file) => {
        if (modules.has(file)) return modules.get(file);
        const exports = {};
        modules.set(file, exports);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText;
        vm.runInNewContext(code, {
          exports,
          require: (id) => {
            if (id === 'electron') return { ipcRenderer: ipc };
            if (file.endsWith('hooks/bootstrap.ts') && id === './runtime')
              return { hookEntry: entry };
            if (id === './adapter')
              return { executeHookEntry: (fn, args) => fn(...args) };
            return load(
              require('node:path').posix.normalize(
                `${file.slice(0, file.lastIndexOf('/'))}/${id}.ts`,
              ),
            );
          },
          process: { isMainFrame: true },
          location: { origin: 'https://www.youtube.com', pathname: '/tv' },
          window: {
            addEventListener: (name, callback) =>
              listeners.set(name, [...(listeners.get(name) ?? []), callback]),
          },
          document: {},
          AbortController,
          console,
          setInterval: () => 1,
          clearInterval: () => {},
        });
        return exports;
      };
      load('src/extensions/page/bootstrap.ts').startPageRuntime({
        sample: () => {
          pageStarts++;
          return () => {};
        },
      });
      assert.equal(hookStarts, 1, 'early hook starts before ready resolves');
      ipc.emit('tubevra:page:state', {}, state(2, false));
      ipc.emit('tubevra:page:state', {}, state(1, true));
      ipc.emit(
        'tubevra:page:state',
        {},
        { ...state(9, true), document: 'old' },
      );
      resolveReady(state(readyRevision, false));
      // Await the real PageRuntime queue, without wall-clock timing assumptions.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(pageStarts, 0, 'stale state must not start the page layer');
      assert.equal(hookStarts, 1);
      assert.equal(hookStops, 1);
      assert.equal(reports.at(-1).revision, readyRevision === 3 ? 3 : 2);
      for (const callback of listeners.get('pagehide')) callback();
      assert.equal(ipc.listenerCount('tubevra:page:state'), 0);
      delete globalThis.fixtureStart;
    });
  }
});

test('late hook failure cleans immediately and old callbacks lose authority', () => {
  let context,
    stops = 0;
  const control = runtime((ctx) => {
    context = ctx;
    return () => {
      stops++;
    };
  })(config(0));
  control.drain();
  context.reportError('late');
  assert.equal(stops, 1);
  assert.equal(control.drain().at(-1).status, 'error');
  context.reportError('obsolete');
  context.requireReload('obsolete');
  assert.equal(control.drain().length, 0);
  control.dispose();
});

test('owned wrappers preserve calls and restore descriptors; conflicting owners are never overwritten', async () => {
  const original = function (n) {
    if (n < 0) throw Error('original');
    return this.base + n;
  };
  const target = { base: 3, call: original };
  const entry = runtime((ctx) => {
    ctx.wrap(target, 'call', (fn, receiver, args) =>
      Reflect.apply(fn, receiver, args),
    );
    return () => undefined;
  });
  const control = entry(config(0));
  assert.equal(target.call(4), 7);
  assert.throws(() => target.call(-1), /original/);
  assert.notEqual(target.call, original);
  assert.equal(control.drain().at(-1).status, 'active');
  control.dispose();
  assert.equal(target.call, original);
  const next = entry(config(1));
  const other = () => 99;
  target.call = other;
  next.apply(config(2, false));
  assert.equal(target.call, other);
  const report = next.drain().at(-1);
  assert.equal(report.status, 'error');
  assert.match(report.reloadReason, /changed|cleanup/);
  next.dispose();
});

test('wrapper cleanup disables a retained chain and preserves Promise identity', async () => {
  const promise = Promise.resolve(7);
  const target = { call: () => promise };
  let effects = 0;
  const control = runtime((ctx) => {
    ctx.wrap(target, 'call', (fn, receiver, args) => {
      effects++;
      return Reflect.apply(fn, receiver, args);
    });
    return () => undefined;
  })(config(0));
  const retained = target.call;
  assert.equal(target.call(), promise);
  target.call = () => retained();
  control.apply(config(1, false));
  assert.equal(target.call(), promise);
  assert.equal(effects, 1);
  assert.equal(control.drain().at(-1).status, 'error');
  control.dispose();
});

test('conflicting bundled hooks clean partial installation without overwriting a target', () => {
  const original = () => 1;
  const target = { call: original };
  const control = runtime((ctx) => {
    const passthrough = (fn, receiver, args) =>
      Reflect.apply(fn, receiver, args);
    ctx.wrap(target, 'call', passthrough);
    ctx.wrap(target, 'call', passthrough);
    return () => undefined;
  })(config(0));
  assert.equal(target.call, original);
  assert.match(control.drain().at(-1).error, /Conflicting/);
});

test('hook teardown reverses resources, survives cleanup failure and keeps reload on disable', () => {
  let context;
  const order = [];
  const events = new EventTarget();
  let calls = 0;
  const control = runtime((ctx) => {
    context = ctx;
    const callback = () => {
      calls++;
    };
    events.addEventListener('test', callback, { signal: ctx.signal });
    ctx.onCleanup(() => {
      order.push(1);
      events.removeEventListener('test', callback);
    });
    ctx.onCleanup(() => {
      order.push(2);
      throw Error('cleanup failed');
    });
    return () => {
      order.push(3);
    };
  })(config(0));
  events.dispatchEvent(new Event('test'));
  context.requireReload('data already consumed');
  control.apply(config(1, false));
  events.dispatchEvent(new Event('test'));
  assert.equal(calls, 1);
  assert.deepEqual(order, [3, 2, 1]);
  const report = control.drain().at(-1);
  assert.equal(report.status, 'error');
  assert.ok(report.reloadReason);
  control.apply(config(2, false));
  assert.ok(control.drain().at(-1).reloadReason);
});
