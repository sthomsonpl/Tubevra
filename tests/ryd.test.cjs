const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const {
  parseRatings,
} = require('../src/extensions/return-youtube-dislike/contracts.ts');
const {
  createRydCoordinator,
} = require('../src/extensions/return-youtube-dislike/service.ts');
const id = 'dQw4w9WgXcQ';
const signal = () => new AbortController().signal;
const bytes = (value) => Buffer.from(JSON.stringify(value));
const response = (video = id, status = 200, retryAfter) => ({
  kind: 'response',
  status,
  retryAfter,
  body: bytes({ id: video, likes: 0, dislikes: 45, rawLikes: 999 }),
});
function fixture(transport = async (video) => response(video)) {
  let now = 0,
    calls = 0;
  const coordinator = createRydCoordinator(
    (...args) => {
      calls++;
      return transport(...args);
    },
    { monotonic: () => now, wall: () => Date.UTC(2026, 0, 1) + now },
  );
  return { coordinator, advance: (ms) => (now += ms), calls: () => calls };
}
test('parser keeps the two API counters, accepts zero and rejects malformed values', () => {
  assert.deepEqual(parseRatings(response().body, id), {
    kind: 'ratings',
    id,
    likes: 0,
    dislikes: 45,
  });
  for (const value of [
    null,
    [],
    {},
    { id, likes: 1 },
    { id, likes: -1, dislikes: 2 },
    { id, likes: '1', dislikes: 2 },
    { id, likes: 1.5, dislikes: 0 },
    { id, likes: Number.MAX_SAFE_INTEGER + 1, dislikes: 0 },
    { id: 'abcdefghijk', likes: 1, dislikes: 1 },
  ])
    assert.equal(parseRatings(bytes(value), id).kind, 'invalid-data');
  for (const body of [
    Buffer.from([255]),
    Buffer.from('{'),
    Buffer.alloc(65537),
  ])
    assert.equal(parseRatings(body, id).kind, 'invalid-data');
});
test('cache expires without stale fallback and disable clears it', async () => {
  const f = fixture();
  let instance = f.coordinator.start();
  await instance.get(id, signal());
  await instance.get(id, signal());
  assert.equal(f.calls(), 1);
  f.advance(300000);
  await instance.get(id, signal());
  assert.equal(f.calls(), 2);
  instance.dispose();
  assert.equal((await instance.get(id, signal())).kind, 'cancelled');
  instance = f.coordinator.start();
  await instance.get(id, signal());
  assert.equal(f.calls(), 3);
  instance.dispose();
});
test('deduplication, eight waiters, two flights and cancellation are bounded', async () => {
  const pending = [];
  const f = fixture(
    (video, abort) =>
      new Promise((resolve) => pending.push({ video, abort, resolve })),
  );
  const instance = f.coordinator.start();
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const results = controllers.map((c) => instance.get(id, c.signal));
  assert.equal((await instance.get(id, signal())).kind, 'busy');
  await Promise.resolve();
  assert.equal(f.calls(), 1);
  controllers[0].abort();
  assert.equal(pending[0].abort.aborted, false);
  controllers.slice(1).forEach((c) => c.abort());
  assert.equal(pending[0].abort.aborted, true);
  assert.ok((await Promise.all(results)).every((r) => r.kind === 'cancelled'));
  const a = instance.get(id, signal()),
    b = instance.get('abcdefghijk', signal());
  assert.equal((await instance.get('ABCDEFGHIJK', signal())).kind, 'busy');
  instance.dispose();
  await Promise.all([a, b]);
});
test('429 survives cancellation and re-enable; stale instances cannot populate cache', async () => {
  let resolve;
  const f = fixture(() => new Promise((r) => (resolve = r)));
  let instance = f.coordinator.start();
  const abort = new AbortController();
  const first = instance.get(id, abort.signal);
  await Promise.resolve();
  abort.abort();
  instance.dispose();
  instance = f.coordinator.start();
  resolve(response(id, 429, '120'));
  await first;
  await Promise.resolve();
  assert.equal((await instance.get(id, signal())).kind, 'rate-limited');
  assert.equal(f.calls(), 1);
  instance.dispose();
});
test('HTTP classification, negative TTL and transient error TTL', async () => {
  for (const [status, kind, retryable, ttl] of [
    [404, 'empty', undefined, 60000],
    [500, 'service-error', true, 30000],
    [400, 'service-error', false, 0],
    [401, 'service-error', false, 0],
    [403, 'service-error', false, 0],
  ]) {
    const f = fixture(async () => response(id, status));
    const instance = f.coordinator.start();
    const result = await instance.get(id, signal());
    assert.equal(result.kind, kind);
    assert.equal(result.retryable, retryable);
    if (ttl) {
      await instance.get(id, signal());
      assert.equal(f.calls(), 1);
      f.advance(ttl);
      await instance.get(id, signal());
      assert.equal(f.calls(), 2);
    }
    instance.dispose();
  }
});
test('token budget survives re-enable and cancelled-before-dispatch work does not consume it', async () => {
  const f = fixture();
  let instance = f.coordinator.start();
  const abort = new AbortController();
  const cancelled = instance.get(id, abort.signal);
  abort.abort();
  await cancelled;
  await Promise.resolve();
  assert.equal(f.calls(), 0);
  for (let i = 0; i < 4; i++) {
    await instance.get(String(i).padStart(11, '0'), signal());
  }
  instance.dispose();
  instance = f.coordinator.start();
  assert.equal((await instance.get(id, signal())).kind, 'busy');
  f.advance(2000);
  assert.equal((await instance.get(id, signal())).kind, 'ratings');
  instance.dispose();
});
test('rolling daily budget is process-owned and expires after 24 hours', async () => {
  const f = fixture();
  let instance = f.coordinator.start();
  for (let i = 0; i < 9000; i++) {
    f.advance(2000);
    assert.equal(
      (await instance.get(String(i).padStart(11, '0'), signal())).kind,
      'ratings',
    );
  }
  instance.dispose();
  instance = f.coordinator.start();
  assert.equal((await instance.get(id, signal())).kind, 'rate-limited');
  f.advance(86400000);
  assert.equal((await instance.get(id, signal())).kind, 'ratings');
  instance.dispose();
});
test('LRU shares a 64-entry bound across positive and negative results', async () => {
  const f = fixture(async (video) => response(video, video === id ? 200 : 404));
  const instance = f.coordinator.start();
  await instance.get(id, signal());
  for (let i = 0; i < 64; i++) {
    f.advance(2000);
    await instance.get(String(i).padStart(11, '0'), signal());
  }
  const before = f.calls();
  f.advance(2000);
  await instance.get(id, signal());
  assert.equal(f.calls(), before + 1);
  instance.dispose();
});

const { EventEmitter } = require('node:events');
const Module = require('node:module');
// Only this Node harness replaces Electron; production always uses its own net
// module and never receives a destination or session from the caller.
function transportFixture(t, behavior) {
  const requests = [],
    sessions = [];
  const fake = {
    session: {
      fromPartition(name, options) {
        const result = { name, options };
        sessions.push(result);
        return result;
      },
    },
    net: {
      request(options) {
        class Request extends EventEmitter {
          aborted = false;
          abort() {
            this.aborted = true;
            this.emit('abort');
            this.emit('close');
          }
          end() {
            queueMicrotask(() => behavior(this));
          }
        }
        const request = new Request();
        requests.push({ options, request });
        return request;
      },
    },
  };
  const original = Module._load;
  let createRydTransport;
  try {
    Module._load = function (name, parent, main) {
      if (name === 'electron') return fake;
      return original.call(this, name, parent, main);
    };
    const filename =
      require.resolve('../src/extensions/return-youtube-dislike/transport.ts');
    delete require.cache[filename];
    ({ createRydTransport } = require(filename));
    t.after(() => {
      delete require.cache[filename];
    });
  } finally {
    Module._load = original;
  }
  return {
    transport: createRydTransport(),
    createRydTransport,
    requests,
    sessions,
  };
}

function reply(req, status, headers, chunks = []) {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: status, headers });
  req.emit('response', res);
  for (const chunk of chunks) res.emit('data', chunk);
  res.emit('end');
  req.emit('close');
}

test('transport builds only the fixed HTTPS request using an isolated credential-free session', async (t) => {
  const f = transportFixture(t, (req) =>
    reply(req, 200, {}, [Buffer.from('[]')]),
  );
  const result = await f.transport(id, signal());
  assert.equal(result.kind, 'response');
  assert.equal(Buffer.from(result.body).toString(), '[]');
  const options = f.requests[0].options;
  const url = new URL(options.url);
  assert.equal(url.origin, 'https://returnyoutubedislikeapi.com');
  assert.equal(url.pathname, '/votes');
  assert.deepEqual([...url.searchParams], [['videoId', id]]);
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.bypassCustomProtocolHandlers, true);
  assert.deepEqual(options.headers, { Accept: 'application/json' });
  assert.equal(options.session, f.sessions[0]);
  assert.match(f.sessions[0].name, /^tubevra-ryd-/);
  assert.deepEqual(f.sessions[0].options, { cache: false });
  const second = f.createRydTransport();
  assert.equal((await second(id, signal())).kind, 'response');
  assert.equal(f.sessions.length, 1);
  assert.equal(f.requests[1].options.session, f.sessions[0]);
  for (const invalid of ['7eec0', '../7eec', '7EEC', 'https://evil.test'])
    assert.deepEqual(await f.transport(invalid, signal()), {
      kind: 'invalid-data',
    });
  assert.equal(f.requests.length, 2);
});

test('transport aborts redirects, oversized streams, cancellation and timeout', async (t) => {
  await t.test('redirect', async (t) => {
    const f = transportFixture(t, (req) =>
      req.emit('redirect', 302, 'GET', 'https://evil.test/', {}),
    );
    assert.deepEqual(await f.transport(id, signal()), {
      kind: 'service-error',
    });
    assert.equal(f.requests[0].request.aborted, true);
  });
  for (const [name, headers, chunks] of [
    ['length header', { 'content-length': '65537' }, []],
    ['streamed body', {}, [Buffer.alloc(40000), Buffer.alloc(30000)]],
    [
      'invalid length header',
      { 'content-length': 'nonsense' },
      [Buffer.alloc(65537)],
    ],
  ])
    await t.test(name, async (t) => {
      const f = transportFixture(t, (req) => reply(req, 200, headers, chunks));
      assert.deepEqual(await f.transport(id, signal()), {
        kind: 'invalid-data',
      });
      assert.equal(f.requests[0].request.aborted, true);
    });
  await t.test('cancellation', async (t) => {
    const f = transportFixture(t, () => {});
    const abort = new AbortController();
    const pending = f.transport(id, abort.signal);
    abort.abort();
    assert.deepEqual(await pending, { kind: 'cancelled' });
    assert.equal(f.requests[0].request.aborted, true);
  });
  await t.test('timeout', async (t) => {
    const f = transportFixture(t, () => {});
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = f.transport(id, signal());
    t.mock.timers.tick(8000);
    assert.deepEqual(await pending, { kind: 'timeout' });
    assert.equal(f.requests[0].request.aborted, true);
  });
});

test('transport preserves Retry-After but never forwards response content for non-200 statuses', async (t) => {
  const f = transportFixture(t, (req) =>
    reply(req, 429, { 'retry-after': '45' }, [Buffer.from('ignored')]),
  );
  const result = await f.transport(id, signal());
  assert.equal(result.kind, 'response');
  assert.equal(result.status, 429);
  assert.equal(result.retryAfter, '45');
  assert.equal(result.body.byteLength, 0);
  assert.equal(f.requests[0].request.aborted, true);
});

test('transport accepts a response exactly at its byte limit', async (t) => {
  const bytes = Buffer.alloc(64 * 1024, 32);
  const f = transportFixture(t, (req) =>
    reply(req, 200, { 'content-length': String(bytes.length) }, [bytes]),
  );
  const result = await f.transport(id, signal());
  assert.equal(result.kind, 'response');
  assert.equal(result.body.byteLength, 64 * 1024);
  assert.equal(f.requests[0].request.aborted, false);
});

test('cooldown parses HTTP dates, grows on missing headers and preserves very long waits', async () => {
  for (const [header, expected] of [
    [undefined, 60000],
    ['bad', 60000],
    ['Thu, 01 Jan 2026 00:02:00 GMT', 120000],
    ['999999999999999999999999999', Number.MAX_SAFE_INTEGER],
  ]) {
    const f = fixture(async () => response(id, 429, header));
    const instance = f.coordinator.start();
    const first = await instance.get(id, signal());
    assert.equal(first.retryAfterMs, expected);
    f.advance(1000);
    assert.ok(
      (await instance.get(id, signal())).retryAfterMs >= expected - 1000,
    );
    instance.dispose();
  }
  const f = fixture(async () => response(id, 429));
  const instance = f.coordinator.start();
  assert.equal((await instance.get(id, signal())).retryAfterMs, 60000);
  f.advance(60000);
  assert.equal((await instance.get(id, signal())).retryAfterMs, 120000);
  instance.dispose();
});
test('late success from a disposed instance never enters the new instance cache', async () => {
  const pending = [];
  const f = fixture(() => new Promise((resolve) => pending.push(resolve)));
  const old = f.coordinator.start();
  const first = old.get(id, signal());
  await Promise.resolve();
  old.dispose();
  const next = f.coordinator.start();
  pending[0](response());
  await first;
  await Promise.resolve();
  const second = next.get(id, signal());
  await Promise.resolve();
  assert.equal(f.calls(), 2);
  pending[1](response());
  assert.equal((await second).kind, 'ratings');
  next.dispose();
});
test('concurrent HTTP reservations cannot overdraw the token bucket', async () => {
  const f = fixture();
  const instance = f.coordinator.start();
  for (let i = 0; i < 3; i++)
    await instance.get(String(i).padStart(11, '0'), signal());
  const last = instance.get(id, signal());
  assert.equal((await instance.get('abcdefghijk', signal())).kind, 'busy');
  await last;
  assert.equal(f.calls(), 4);
  instance.dispose();
});

const {
  createRydPresentation,
} = require('../src/extensions/return-youtube-dislike/presentation.ts');
const {
  connect,
} = require('../src/extensions/return-youtube-dislike/bridge.ts');
const {
  RYD_IPC,
} = require('../src/extensions/return-youtube-dislike/contracts.ts');
const flush = async () => {
  for (let n = 0; n < 80; n++) await Promise.resolve();
};
test('presentation discards A -> B -> A results, clears immediately and revokes subscribers', async () => {
  const pending = [];
  const p = createRydPresentation(
    (id, signal) =>
      new Promise((resolve) => pending.push({ id, signal, resolve })),
  );
  const snapshots = [];
  p.subscribe((s) => snapshots.push(s));
  p.bind(id);
  p.bind('abcdefghijk');
  p.bind(id);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ kind: 'ratings', id, likes: 999, dislikes: 999 });
  await flush();
  assert.equal(p.snapshot().kind, 'loading');
  pending[2].resolve({ kind: 'ratings', id, likes: 0, dislikes: 45 });
  await flush();
  assert.equal(p.snapshot().likes, 0);
  p.suspend();
  assert.equal(p.snapshot().kind, 'no-video');
  assert.equal('likes' in p.snapshot(), false);
  p.dispose();
  const count = snapshots.length;
  p.bind(id);
  assert.equal(snapshots.length, count);
  assert.ok(
    snapshots.every((s, i) => i === 0 || s.version > snapshots[i - 1].version),
  );
});
test('RYD private bridge rejects untrusted input, replay and stale revision, then renews', async () => {
  const p = createRydPresentation(async (videoId) => ({
    kind: 'ratings',
    id: videoId,
    likes: 1,
    dislikes: 2,
  }));
  const active = { value: p, abort: new AbortController() };
  let revision = 0,
    document = 'doc',
    handler;
  const listeners = new Set();
  const bridge = connect({
    ipc: {
      handle(channel, fn) {
        assert.equal(channel, RYD_IPC);
        handler = fn;
      },
      removeHandler() {},
    },
    engine: {
      getService: () => active,
      snapshot: () => ({ revision }),
      onAuthorityChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    currentDocument: () => document,
    trusted: (e) => e === 'trusted',
  });
  const request = {
    operation: 'begin',
    document,
    revision,
    instance: '',
    sequence: 1,
    videoId: null,
    unsupported: false,
  };
  assert.throws(() => handler('foreign', request));
  assert.throws(() => handler('trusted', { ...request, extra: true }));
  const instance = handler('trusted', request);
  const binding = {
    ...request,
    operation: 'bind',
    instance,
    sequence: 2,
    videoId: id,
  };
  handler('trusted', binding);
  await flush();
  assert.equal(p.snapshot().kind, 'ready');
  assert.throws(() => handler('trusted', binding));
  revision++;
  for (const listener of listeners) listener();
  assert.equal(p.snapshot().kind, 'no-video');
  assert.throws(() => handler('trusted', { ...binding, sequence: 3 }));
  handler('trusted', { ...binding, operation: 'renew', revision, sequence: 3 });
  handler('trusted', { ...binding, revision, sequence: 4 });
  await flush();
  assert.equal(p.snapshot().kind, 'ready');
  document = 'new';
  bridge.invalidate();
  assert.equal(p.snapshot().kind, 'no-video');
  assert.throws(() =>
    handler('trusted', { ...binding, revision, sequence: 5 }),
  );
  bridge.dispose();
  p.dispose();
});
test('retry budget survives revision suspension and permanent errors never retry', async (t) => {
  let now = 0,
    callback,
    calls = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, delay) => {
    callback = () => {
      now += delay;
      fn();
    };
    return 123;
  });
  t.mock.method(global, 'clearTimeout', () => {});
  const p = createRydPresentation(async () => {
    calls++;
    return { kind: 'network-error', retryable: true };
  });
  p.bind(id);
  await flush();
  callback();
  await flush();
  callback();
  await flush();
  assert.equal(calls, 3);
  p.suspend();
  p.bind(id, false, true);
  await flush();
  const before = calls;
  callback();
  await flush();
  assert.equal(calls, before);
  p.dispose();
});

const {
  createRydConnection,
} = require('../src/extensions/return-youtube-dislike/page-transport.ts');
test('private transport closes late handshakes and serializes revision updates', async () => {
  const abort = new AbortController(),
    calls = [];
  let complete;
  const connection = createRydConnection(
    (v) => {
      calls.push(v);
      return v.operation === 'begin'
        ? new Promise((r) => (complete = r))
        : Promise.resolve(null);
    },
    'doc',
    0,
    abort.signal,
  );
  await flush();
  abort.abort();
  complete('12345678-1234-1234-1234-123456789abc');
  await connection.ready;
  await flush();
  assert.deepEqual(
    calls.map((v) => v.operation),
    ['begin', 'end'],
  );
  const log = [];
  const c = createRydConnection(
    async (v) => {
      log.push(v);
      return v.operation === 'begin'
        ? '12345678-1234-1234-1234-123456789abc'
        : null;
    },
    'doc',
    0,
    new AbortController().signal,
  );
  await c.ready;
  c.renew(1);
  c.renew(2);
  c.bind(id, false);
  await flush();
  assert.equal(log.at(-1).revision, 2);
  assert.equal(log.at(-1).operation, 'bind');
  assert.ok(log.every((v, i) => !i || v.sequence > log[i - 1].sequence));
  c.dispose();
});
test('TV identity reader serializes without closure and ignores live/seek requirements', () => {
  const {
    readRydPlayer,
  } = require('../src/extensions/return-youtube-dislike/tv.ts');
  const vm = require('node:vm');
  const player = {
    getVideoData: () => ({ video_id: id, isLive: true }),
    getPlayerResponse: () => ({ videoDetails: { videoId: id } }),
    isInline: () => false,
    getAdState: () => -1,
    classList: { contains: () => false },
  };
  const sample = vm.runInNewContext(`(${readRydPlayer.toString()})()`, {
    document: { getElementById: () => player },
  });
  assert.equal(sample.videoId, id);
  assert.equal(sample.responseId, id);
  assert.equal(sample.ad, false);
  player.getAdState = () => 1;
  assert.equal(
    vm.runInNewContext(`(${readRydPlayer.toString()})()`, {
      document: { getElementById: () => player },
    }).ad,
    true,
  );
});
