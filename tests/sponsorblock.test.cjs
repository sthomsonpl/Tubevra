const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
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

describe('API validation', () => {
  const {
    videoHashPrefix,
    parseSponsorBucket,
    retryAfterMilliseconds,
  } = require('../src/extensions/sponsorblock/api-validation.ts');

  // Fixture IDs share a hash prefix; segment data below is synthetic.
  const video = '-lErGZZgUbY';
  const collision = '000000010fp';
  const prefix = '7eec';
  const segment = (overrides = {}) => ({
    segment: [12.5, 18.25],
    category: 'sponsor',
    actionType: 'skip',
    videoDuration: 50,
    ...overrides,
  });
  const body = (value) => Buffer.from(JSON.stringify(value));
  const entry = (videoID = video, segments = [segment()]) => ({
    videoID,
    segments,
  });
  const parse = (value) => parseSponsorBucket(body(value), video, prefix);

  test('hashing accepts only an exact YouTube ID and uses the first four SHA-256 hex characters', () => {
    assert.equal(videoHashPrefix(video), prefix);
    assert.equal(videoHashPrefix(collision), prefix);
    for (const invalid of [
      '',
      'invalid',
      `${video}x`,
      ` ${video}`,
      'abcdefghij/',
      null,
      123,
    ])
      assert.throws(() => videoHashPrefix(invalid), /Invalid YouTube video ID/);
  });

  test('prefix bucket retains only the exact video and copies the required fields', () => {
    const result = parse([
      entry(collision, [segment({ segment: [1, 2], videoDuration: 0 })]),
      entry(video, [
        segment({ UUID: 'ignored', votes: 5 }),
        segment({ segment: [25, 28], videoDuration: 0 }),
      ]),
    ]);
    assert.deepEqual(result, {
      kind: 'segments',
      segments: [
        { start: 12.5, end: 18.25, videoDuration: 50 },
        { start: 25, end: 28, videoDuration: 0 },
      ],
    });
    assert.deepEqual(parse([]), { kind: 'empty' });
    assert.deepEqual(parse([entry(collision)]), { kind: 'empty' });
    assert.deepEqual(parse([entry(video, [])]), { kind: 'empty' });
  });

  test('malformed, oversized, invalid UTF-8 and inconsistent buckets are rejected', () => {
    const invalid = { kind: 'invalid-data' };
    for (const bytes of [
      Buffer.from(''),
      Buffer.from('<html>'),
      Buffer.from('{'),
      Buffer.from([0xff]),
      Buffer.alloc(1024 * 1024 + 1),
    ])
      assert.deepEqual(parseSponsorBucket(bytes, video, prefix), invalid);
    for (const input of [
      null,
      {},
      [null],
      [{ videoID: video }],
      [entry('abcdefghijk')],
      [entry(video), entry(video)],
      [entry(collision), entry(collision)],
    ])
      assert.deepEqual(parse(input), invalid);
    assert.deepEqual(
      parseSponsorBucket(body([entry()]), video, '0000'),
      invalid,
    );
    assert.deepEqual(
      parseSponsorBucket(body([entry()]), 'bad', prefix),
      invalid,
    );
    assert.deepEqual(
      parse(Array.from({ length: 4097 }, () => entry())),
      invalid,
    );
    assert.deepEqual(
      parse([
        entry(
          video,
          Array.from({ length: 513 }, () => segment()),
        ),
      ]),
      invalid,
    );
    assert.deepEqual(
      parse([
        entry(
          collision,
          Array.from({ length: 8193 }, () => segment()),
        ),
      ]),
      invalid,
    );
  });

  test('segment shape, time ranges, category and action are validated across the whole bucket', () => {
    const invalidSegments = [
      null,
      {},
      segment({ category: 'intro' }),
      segment({ actionType: 'mute' }),
      segment({ segment: [0] }),
      segment({ segment: [0, 1, 2] }),
      segment({ segment: [-1, 1] }),
      segment({ segment: [1, 1] }),
      segment({ segment: [2, 1] }),
      segment({ segment: ['1', 2] }),
      segment({ segment: [null, 2] }),
      segment({ segment: [1, 315_576_001] }),
      segment({ videoDuration: -1 }),
      segment({ videoDuration: '50' }),
      segment({ videoDuration: null }),
      segment({ videoDuration: 315_576_001 }),
    ];
    for (const invalid of invalidSegments) {
      assert.deepEqual(parse([entry(video, [invalid])]), {
        kind: 'invalid-data',
      });
      assert.deepEqual(parse([entry(collision, [invalid]), entry()]), {
        kind: 'invalid-data',
      });
    }
    // JSON numeric overflow parses as Infinity despite using valid JSON syntax.
    const overflow = Buffer.from(
      `[{"videoID":"${video}","segments":[{"segment":[0,1e999],"category":"sponsor","actionType":"skip","videoDuration":0}]}]`,
    );
    assert.deepEqual(parseSponsorBucket(overflow, video, prefix), {
      kind: 'invalid-data',
    });
  });

  test('Retry-After handles seconds and HTTP dates without shortening long valid delays', () => {
    const now = Date.parse('Sun, 06 Nov 1994 08:49:00 GMT');
    assert.equal(retryAfterMilliseconds('5', now), 5000);
    assert.equal(retryAfterMilliseconds('0005', now), 5000);
    assert.equal(retryAfterMilliseconds('000000000000000000000', now), 0);
    assert.equal(
      retryAfterMilliseconds('Sun, 06 Nov 1994 08:49:37 GMT', now),
      37000,
    );
    assert.equal(
      retryAfterMilliseconds('Sun, 06 Nov 1994 08:48:37 GMT', now),
      0,
    );
    for (const bad of [
      undefined,
      '',
      '-1',
      '1.2',
      'tomorrow',
      'Mon, 06 Nov 1994 08:49:37 GMT',
      'Sun, 06 Nov 1994 08:49:99 GMT',
    ])
      assert.equal(retryAfterMilliseconds(bad, now), 60000);
    assert.equal(
      retryAfterMilliseconds('9999999999999999999999', now),
      Infinity,
    );
    assert.equal(retryAfterMilliseconds('5', NaN), 60000);
  });
});

describe('API client and transport', () => {
  const { EventEmitter } = require('node:events');
  const Module = require('node:module');
  const {
    createSponsorApiClient,
  } = require('../src/extensions/sponsorblock/api.ts');
  const video = '-lErGZZgUbY';
  const signal = () => new AbortController().signal;
  const body = (data) => Buffer.from(JSON.stringify(data));
  const sample = [
    {
      videoID: video,
      segments: [
        {
          segment: [12, 18],
          category: 'sponsor',
          actionType: 'skip',
          videoDuration: 50,
        },
      ],
    },
  ];
  const response = (status, content = new Uint8Array(), retryAfter) => ({
    kind: 'response',
    status,
    body: content,
    retryAfter,
  });

  test('client hashes locally, selects the exact film and classifies HTTP and network errors', async () => {
    let sent,
      next = response(200, body(sample));
    const client = createSponsorApiClient(async (prefix, actualSignal) => {
      sent = { prefix, signal: actualSignal };
      if (next instanceof Error) throw next;
      return next;
    });
    const source = signal();
    assert.deepEqual(await client(video, source), {
      kind: 'segments',
      segments: [{ start: 12, end: 18, videoDuration: 50 }],
    });
    assert.deepEqual(sent, { prefix: '7eec', signal: source });
    next = response(404);
    assert.deepEqual(await client(video, source), { kind: 'empty' });
    for (const status of [204, 301, 400, 401, 403, 500, 503]) {
      next = response(status);
      assert.deepEqual(await client(video, source), { kind: 'service-error' });
    }
    next = response(200, Buffer.from('<html>'));
    assert.deepEqual(await client(video, source), { kind: 'invalid-data' });
    for (const kind of [
      'timeout',
      'cancelled',
      'network-error',
      'invalid-data',
      'service-error',
    ]) {
      next = { kind };
      assert.deepEqual(await client(video, source), { kind });
    }
    next = Error('DNS');
    assert.deepEqual(await client(video, source), { kind: 'network-error' });
    sent = undefined;
    assert.deepEqual(await client('bad', source), { kind: 'invalid-data' });
    assert.equal(sent, undefined);
    const aborted = new AbortController();
    aborted.abort();
    assert.deepEqual(await client(video, aborted.signal), {
      kind: 'cancelled',
    });
    assert.equal(sent, undefined);
  });

  test('429 blocks new requests until Retry-After, without auto retry or shortening long delays', async () => {
    let monotonic = 10,
      calls = 0;
    let next = response(429, undefined, '5');
    const client = createSponsorApiClient(
      async () => {
        calls++;
        return next;
      },
      {
        monotonic: () => monotonic,
        wall: () => Date.parse('Sun, 06 Nov 1994 08:49:00 GMT'),
      },
    );
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: 5000,
    });
    monotonic += 1000;
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: 4000,
    });
    assert.equal(calls, 1);
    monotonic += 4000;
    next = response(429, undefined, '9999999999999999999999');
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    });
    monotonic += 100000000;
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(calls, 2);
  });

  test('cancelling a request racing an already received 429 does not erase the service limit', async () => {
    let calls = 0;
    const abort = new AbortController();
    const client = createSponsorApiClient(
      async () => {
        calls++;
        abort.abort();
        return response(429, undefined, '60');
      },
      { monotonic: () => 1, wall: () => 0 },
    );
    assert.deepEqual(await client(video, abort.signal), { kind: 'cancelled' });
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: 60000,
    });
    assert.equal(calls, 1);
  });

  test('concurrent 429 responses preserve the longest server cooldown', async () => {
    const pending = [];
    let now = 0;
    const client = createSponsorApiClient(
      () => new Promise((resolve) => pending.push(resolve)),
      {
        monotonic: () => now,
        wall: () => Date.parse('Sun, 06 Nov 1994 08:49:00 GMT'),
      },
    );
    const first = client(video, signal());
    const second = client(video, signal());
    pending[1](response(429, undefined, 'Sun, 06 Nov 1994 08:49:37 GMT'));
    assert.deepEqual(await second, {
      kind: 'rate-limited',
      retryAfterMs: 37000,
    });
    pending[0](response(429, undefined, '1'));
    assert.deepEqual(await first, {
      kind: 'rate-limited',
      retryAfterMs: 37000,
    });
    now = 2000;
    assert.deepEqual(await client(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: 35000,
    });
    assert.equal(pending.length, 2);
  });

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
    let createSponsorTransport;
    try {
      Module._load = function (name, parent, main) {
        if (name === 'electron') return fake;
        return original.call(this, name, parent, main);
      };
      const filename =
        require.resolve('../src/extensions/sponsorblock/transport.ts');
      delete require.cache[filename];
      ({ createSponsorTransport } = require(filename));
      t.after(() => {
        delete require.cache[filename];
      });
    } finally {
      Module._load = original;
    }
    return {
      transport: createSponsorTransport(),
      createSponsorTransport,
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
    const result = await f.transport('7eec', signal());
    assert.equal(result.kind, 'response');
    assert.equal(Buffer.from(result.body).toString(), '[]');
    const options = f.requests[0].options;
    const url = new URL(options.url);
    assert.equal(url.origin, 'https://sponsor.ajay.app');
    assert.equal(url.pathname, '/api/skipSegments/7eec');
    assert.deepEqual([...url.searchParams.keys()].sort(), [
      'actionTypes',
      'categories',
      'service',
    ]);
    assert.equal(url.searchParams.get('categories'), '["sponsor"]');
    assert.equal(url.searchParams.get('actionTypes'), '["skip"]');
    assert.equal(url.searchParams.get('service'), 'YouTube');
    assert.ok(!options.url.includes(video));
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.bypassCustomProtocolHandlers, true);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.session, f.sessions[0]);
    assert.match(f.sessions[0].name, /^tubevra-sponsor-/);
    assert.deepEqual(f.sessions[0].options, { cache: false });
    const second = f.createSponsorTransport();
    assert.equal((await second('7eec', signal())).kind, 'response');
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
      assert.deepEqual(await f.transport('7eec', signal()), {
        kind: 'service-error',
      });
      assert.equal(f.requests[0].request.aborted, true);
    });
    for (const [name, headers, chunks] of [
      ['length header', { 'content-length': '1048577' }, []],
      ['streamed body', {}, [Buffer.alloc(700000), Buffer.alloc(400000)]],
      [
        'invalid length header',
        { 'content-length': 'nonsense' },
        [Buffer.alloc(1048577)],
      ],
    ])
      await t.test(name, async (t) => {
        const f = transportFixture(t, (req) =>
          reply(req, 200, headers, chunks),
        );
        assert.deepEqual(await f.transport('7eec', signal()), {
          kind: 'invalid-data',
        });
        assert.equal(f.requests[0].request.aborted, true);
      });
    await t.test('cancellation', async (t) => {
      const f = transportFixture(t, () => {});
      const abort = new AbortController();
      const pending = f.transport('7eec', abort.signal);
      abort.abort();
      assert.deepEqual(await pending, { kind: 'cancelled' });
      assert.equal(f.requests[0].request.aborted, true);
    });
    await t.test('timeout', async (t) => {
      const f = transportFixture(t, () => {});
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const pending = f.transport('7eec', signal());
      t.mock.timers.tick(10000);
      assert.deepEqual(await pending, { kind: 'timeout' });
      assert.equal(f.requests[0].request.aborted, true);
    });
  });

  test('transport preserves Retry-After but never forwards response content for non-200 statuses', async (t) => {
    const f = transportFixture(t, (req) =>
      reply(req, 429, { 'retry-after': '45' }, [Buffer.from('ignored')]),
    );
    const result = await f.transport('7eec', signal());
    assert.equal(result.kind, 'response');
    assert.equal(result.status, 429);
    assert.equal(result.retryAfter, '45');
    assert.equal(result.body.byteLength, 0);
    assert.equal(f.requests[0].request.aborted, true);
  });

  test('transport accepts a response exactly at its byte limit', async (t) => {
    const bytes = Buffer.alloc(1024 * 1024, 32);
    const f = transportFixture(t, (req) =>
      reply(req, 200, { 'content-length': String(bytes.length) }, [bytes]),
    );
    const result = await f.transport('7eec', signal());
    assert.equal(result.kind, 'response');
    assert.equal(result.body.byteLength, 1024 * 1024);
    assert.equal(f.requests[0].request.aborted, false);
  });
});

describe('Service lifecycle', () => {
  const { createHash } = require('node:crypto');
  const {
    createSponsorCoordinator,
  } = require('../src/extensions/sponsorblock/service.ts');
  const {
    videoHashPrefix,
  } = require('../src/extensions/sponsorblock/api-validation.ts');
  const video = '-lErGZZgUbY';
  const collision = '000000010fp';
  const signal = () => new AbortController().signal;
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const segment = (id, count = 1) => ({
    videoID: id,
    segments: Array.from({ length: count }, (_, index) => ({
      segment: [100000 + index, 100000.5 + index],
      category: 'sponsor',
      actionType: 'skip',
      videoDuration: 200000,
    })),
  });
  const response = (entries, status = 200, retryAfter) => ({
    kind: 'response',
    status,
    retryAfter,
    body: Buffer.from(JSON.stringify(entries)),
  });
  function clock() {
    let now = 0;
    return {
      monotonic: () => now,
      wall: () => 0,
      advance: (n) => {
        now += n;
      },
    };
  }
  function ids(count) {
    const result = [],
      seen = new Set();
    for (let i = 0; result.length < count; i++) {
      const id = i.toString(36).padStart(11, '0');
      const prefix = createHash('sha256').update(id).digest('hex').slice(0, 4);
      if (!seen.has(prefix)) {
        seen.add(prefix);
        result.push(id);
      }
    }
    return result;
  }

  test('cache copies values, expires positive and empty results, and does not persist on disable', async () => {
    const time = clock();
    let calls = 0,
      empty = false;
    const coordinator = createSponsorCoordinator(async () => {
      calls++;
      return response(empty ? [] : [segment(video)]);
    }, time);
    const service = coordinator.start();
    const original = await service.get(video, signal());
    assert.equal(original.kind, 'segments');
    original.segments[0].end = 9;
    assert.equal(
      (await service.get(video, signal())).segments[0].end,
      100000.5,
    );
    assert.equal(calls, 1);
    time.advance(15 * 60_000);
    empty = true;
    assert.deepEqual(await service.get(video, signal()), { kind: 'empty' });
    assert.equal(calls, 2);
    time.advance(2 * 60_000 - 1);
    assert.deepEqual(await service.get(video, signal()), { kind: 'empty' });
    assert.equal(calls, 2);
    time.advance(1);
    assert.deepEqual(await service.get(video, signal()), { kind: 'empty' });
    assert.equal(calls, 3);
    service.dispose();
    assert.deepEqual(await service.get(video, signal()), { kind: 'cancelled' });
    time.advance(2000);
    const next = coordinator.start();
    assert.deepEqual(await next.get(video, signal()), { kind: 'empty' });
    assert.equal(calls, 4);
    next.dispose();
  });

  test('same prefix is shared while each subscriber has independent cancellation and matching', async () => {
    let finish,
      underlying,
      calls = 0;
    const service = createSponsorCoordinator((_prefix, signal) => {
      calls++;
      underlying = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }, clock()).start();
    const a = new AbortController();
    const b = new AbortController();
    const first = service.get(video, a.signal);
    const second = service.get(collision, b.signal);
    await flush();
    assert.equal(calls, 1);
    a.abort();
    assert.deepEqual(await first, { kind: 'cancelled' });
    assert.equal(underlying.aborted, false);
    const other = segment(collision);
    other.segments[0].segment = [42, 43];
    finish(response([segment(video), other]));
    const result = await second;
    assert.equal(result.kind, 'segments');
    assert.deepEqual(result.segments, [
      { start: 42, end: 43, videoDuration: 200000 },
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await service.get(collision, signal()), result);
    service.dispose();
  });

  test('all callers cancelling aborts the request, and late responses do not affect a replacement', async () => {
    const calls = [];
    const service = createSponsorCoordinator(
      (_prefix, sig) => new Promise((resolve) => calls.push({ sig, resolve })),
      clock(),
    ).start();
    const abort = new AbortController();
    const first = service.get(video, abort.signal);
    await flush();
    abort.abort();
    assert.deepEqual(await first, { kind: 'cancelled' });
    assert.equal(calls[0].sig.aborted, true);
    const second = service.get(video, signal());
    await flush();
    assert.equal(calls.length, 2);
    calls[0].resolve(response([]));
    await flush();
    calls[1].resolve(response([segment(video)]));
    assert.equal((await second).kind, 'segments');
    service.dispose();
  });

  test('limits two simultaneous prefix requests and eight waiting callers', async () => {
    const values = ids(3);
    const requests = [];
    const service = createSponsorCoordinator(
      (_prefix, sig) =>
        new Promise((resolve) => requests.push({ sig, resolve })),
      clock(),
    ).start();
    const callers = Array.from({ length: 7 }, () =>
      service.get(values[0], signal()),
    );
    callers.push(service.get(values[1], signal()));
    await flush();
    assert.equal(requests.length, 2);
    assert.deepEqual(await service.get(values[2], signal()), { kind: 'busy' });
    service.dispose();
    assert.ok(requests.every((item) => item.sig.aborted));
    assert.ok(
      (await Promise.all(callers)).every(
        (result) => result.kind === 'cancelled',
      ),
    );

    const nextRequests = [];
    const next = createSponsorCoordinator(
      (_prefix, sig) =>
        new Promise((resolve) => nextRequests.push({ sig, resolve })),
      clock(),
    ).start();
    const one = next.get(values[0], signal());
    const two = next.get(values[1], signal());
    await flush();
    assert.deepEqual(await next.get(values[2], signal()), { kind: 'busy' });
    next.dispose();
    await Promise.all([one, two]);
  });

  test('token bucket bounds new requests and refills at 30 per minute', async () => {
    const time = clock(),
      values = ids(6);
    let calls = 0;
    const service = createSponsorCoordinator(async () => {
      calls++;
      return response([]);
    }, time).start();
    for (const id of values.slice(0, 4))
      assert.equal((await service.get(id, signal())).kind, 'empty');
    assert.equal(calls, 4);
    assert.deepEqual(await service.get(values[4], signal()), { kind: 'busy' });
    time.advance(1999);
    assert.deepEqual(await service.get(values[4], signal()), { kind: 'busy' });
    time.advance(1);
    assert.equal((await service.get(values[4], signal())).kind, 'empty');
    assert.equal(calls, 5);
    service.dispose();
  });

  test('re-enabling cannot reset the HTTP token bucket', async () => {
    const time = clock(),
      values = ids(5);
    let calls = 0;
    const coordinator = createSponsorCoordinator(async () => {
      calls++;
      return response([]);
    }, time);
    const first = coordinator.start();
    for (const id of values.slice(0, 4)) await first.get(id, signal());
    first.dispose();
    const second = coordinator.start();
    assert.deepEqual(await second.get(values[4], signal()), { kind: 'busy' });
    assert.equal(calls, 4);
    time.advance(2000);
    assert.equal((await second.get(values[4], signal())).kind, 'empty');
    assert.equal(calls, 5);
    second.dispose();
  });

  test('late results from a disabled instance cannot populate the replacement cache', async () => {
    const requests = [];
    const coordinator = createSponsorCoordinator(
      (_prefix, sig) =>
        new Promise((resolve) => requests.push({ sig, resolve })),
      clock(),
    );
    const old = coordinator.start();
    const stale = old.get(video, signal());
    await flush();
    old.dispose();
    assert.equal((await stale).kind, 'cancelled');
    const current = coordinator.start();
    const fresh = current.get(video, signal());
    await flush();
    requests[0].resolve(response([segment(video)]));
    requests[1].resolve(response([]));
    assert.deepEqual(await fresh, { kind: 'empty' });
    assert.deepEqual(await current.get(video, signal()), { kind: 'empty' });
    assert.equal(requests.length, 2);
    current.dispose();
  });

  test('errors remain visible and suppress repeated calls for 30 seconds', async () => {
    const time = clock();
    let calls = 0;
    const service = createSponsorCoordinator(async () => {
      calls++;
      return { kind: 'network-error' };
    }, time).start();
    assert.deepEqual(await service.get(video, signal()), {
      kind: 'network-error',
    });
    assert.deepEqual(await service.get(video, signal()), {
      kind: 'network-error',
    });
    assert.equal(calls, 1);
    time.advance(30_000);
    assert.deepEqual(await service.get(video, signal()), {
      kind: 'network-error',
    });
    assert.equal(calls, 2);
    service.dispose();
  });

  test('availability reflects fresh requests; cached success does not hide a later network error', async () => {
    const time = clock();
    const reports = [];
    let fail = false;
    const service = createSponsorCoordinator(
      async () =>
        fail
          ? { kind: 'network-error' }
          : response([segment(video), segment(collision)]),
      time,
    ).start((value) => reports.push(value));
    assert.equal((await service.get(video, signal())).kind, 'segments');
    assert.deepEqual(reports, ['available']);
    fail = true;
    assert.equal(
      (await service.get(collision, signal())).kind,
      'network-error',
    );
    assert.deepEqual(reports, ['available', 'network-error']);
    assert.equal((await service.get(video, signal())).kind, 'segments');
    assert.deepEqual(reports, ['available', 'network-error']);
    time.advance(30_000);
    fail = false;
    assert.equal((await service.get(collision, signal())).kind, 'segments');
    assert.deepEqual(reports, ['available', 'network-error', 'available']);
    const abort = new AbortController();
    abort.abort();
    assert.equal((await service.get(video, abort.signal)).kind, 'cancelled');
    assert.equal(reports.length, 3);
    service.dispose();
  });

  test('service emits bounded availability codes for request failures and rate limits', async () => {
    for (const [transportResult, expected] of [
      [{ kind: 'network-error' }, 'network-error'],
      [{ kind: 'service-error' }, 'service-error'],
      [{ kind: 'timeout' }, 'timeout'],
      [{ kind: 'invalid-data' }, 'invalid-data'],
      [{ kind: 'busy' }, 'busy'],
      [response([], 429, '60'), 'rate-limited'],
    ]) {
      const seen = [];
      const service = createSponsorCoordinator(
        async () => transportResult,
        clock(),
      ).start((value) => seen.push(value));
      await service.get(video, signal());
      assert.deepEqual(seen, [expected]);
      service.dispose();
    }
  });

  test('shared HTTP timeout aborts the transport and starts the error cooldown', async (t) => {
    const time = clock();
    let calls = 0,
      underlying;
    const service = createSponsorCoordinator((_prefix, signal) => {
      calls++;
      underlying = signal;
      return new Promise(() => {});
    }, time).start();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = service.get(video, signal());
    await flush();
    t.mock.timers.tick(9500);
    assert.deepEqual(await pending, { kind: 'timeout' });
    assert.equal(underlying.aborted, true);
    assert.deepEqual(await service.get(video, signal()), { kind: 'timeout' });
    assert.equal(calls, 1);
    service.dispose();
  });

  test('429 and token limits survive disable/re-enable, including a late 429 after cancellation', async () => {
    const time = clock();
    let finish,
      calls = 0;
    const coordinator = createSponsorCoordinator(() => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }, time);
    const first = coordinator.start();
    const request = first.get(video, signal());
    await flush();
    first.dispose();
    assert.deepEqual(await request, { kind: 'cancelled' });
    const second = coordinator.start();
    finish(response([], 429, '120'));
    await flush();
    assert.deepEqual(await second.get(video, signal()), {
      kind: 'rate-limited',
      retryAfterMs: 120_000,
    });
    assert.equal(calls, 1);
    second.dispose();
    time.advance(120_000);
    const third = coordinator.start();
    const next = third.get(video, signal());
    await flush();
    assert.equal(calls, 2);
    finish(response([]));
    assert.equal((await next).kind, 'empty');
    third.dispose();
  });

  test('cache evicts least-recently-used entries at 64 items and at its byte budget', async () => {
    for (const segmentCount of [1, 512]) {
      const time = clock();
      const values = ids(segmentCount === 1 ? 65 : 50);
      const byPrefix = new Map(values.map((id) => [videoHashPrefix(id), id]));
      let calls = 0;
      const service = createSponsorCoordinator(async (prefix) => {
        calls++;
        return response([segment(byPrefix.get(prefix), segmentCount)]);
      }, time).start();
      for (const id of values) {
        assert.equal((await service.get(id, signal())).kind, 'segments');
        time.advance(2000);
      }
      const initial = calls;
      assert.equal((await service.get(values[0], signal())).kind, 'segments');
      assert.equal(
        calls,
        initial + 1,
        `oldest entry evicted for ${segmentCount} segments`,
      );
      service.dispose();
    }
  });
});

describe('Private bridge', () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');
  const {
    TubervaExtensions,
  } = require('../src/extensions/tuberva-extensions.ts');
  const { connectPage } = require('../src/extensions/main/page-bridge.ts');
  const {
    SPONSOR_IPC,
  } = require('../src/extensions/sponsorblock/contracts.ts');
  const {
    connectSponsorSegments,
  } = require('../src/extensions/sponsorblock/bridge.ts');
  const {
    sponsorMainContext,
  } = require('../src/extensions/sponsorblock/main.ts');
  const {
    withSponsorConnection,
  } = require('../src/extensions/sponsorblock/page-transport.ts');
  const {
    sponsorAvailability,
    sponsorPlayback,
  } = require('../src/extensions/sponsorblock/diagnostics.ts');
  const {
    createSponsorConnection,
  } = require('../src/extensions/sponsorblock/page-transport.ts');
  const { PageRuntime } = require('../src/extensions/page/runtime.ts');
  const { PAGE_IPC } = require('../src/extensions/page/channels.ts');
  const videoId = '-lErGZZgUbY';
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  async function fixture(t, handler = () => ({ kind: 'empty' }), options = {}) {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tubevra-sponsor-bridge-'),
    );
    const handlers = new Map();
    const ipc = {
      on: (name, callback) => handlers.set(name, callback),
      handle: (name, callback) => handlers.set(name, callback),
      removeListener: (name) => handlers.delete(name),
      removeHandler: (name) => handlers.delete(name),
    };
    const contents = Object.assign(new EventEmitter(), {
      mainFrame: { url: 'https://www.youtube.com/tv' },
      isDestroyed: () => false,
      send: () => {},
    });
    let bridge;
    let calls = 0;
    let registration;
    let reportAvailability;
    const engine = await TubervaExtensions.open(
      dir,
      [
        {
          id: 'sponsorblock',
          name: 'Test SponsorBlock',
          description: 'fixture only',
          modes: ['tv'],
          main: true,
          page: true,
          defaultEnabled: options.enabled ?? true,
        },
        {
          id: 'sample',
          name: 'Sample',
          description: 'fixture only',
          modes: ['tv'],
          main: true,
          page: true,
          defaultEnabled: true,
        },
      ],
      { onBeforeRequest() {} },
      {
        sponsorblock: (context) => {
          const sponsor = sponsorMainContext(context);
          registration = sponsor.registerSponsorSegments;
          reportAvailability = sponsor.reportSponsorAvailability;
          if (options.register !== false)
            registration((id, signal) => {
              calls++;
              return handler(id, signal);
            });
          if (options.failStart) throw Error('Fixture startup failure');
          return () => {};
        },
        sample: (context) => {
          assert.equal(context.registerSponsorSegments, undefined);
          return () => {};
        },
      },
      () => bridge?.publish(),
    );
    bridge = connectPage(ipc, contents, engine, {
      sponsorblock: connectSponsorSegments,
    });
    t.after(async () => {
      bridge.dispose();
      await engine.dispose();
      assert.equal(handlers.size, 0);
      assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(dir).startsWith('tubevra-sponsor-bridge-'));
      await fs.rm(dir, { recursive: true, force: true });
    });
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const config = () => handlers.get(PAGE_IPC.ready)(event);
    const initial = config();
    const invoke = async (channel, payload) =>
      handlers.get(channel)(event, payload);
    const begin = () =>
      invoke(SPONSOR_IPC.begin, {
        document: initial.document,
        revision: engine.snapshot().revision,
      });
    return {
      handlers,
      event,
      contents,
      engine,
      bridge,
      config,
      initial,
      invoke,
      begin,
      calls: () => calls,
      registration: () => registration,
      reporter: () => reportAvailability,
      directory: dir,
    };
  }

  test('playback diagnostics are recoverable, bounded and cannot grant service authority', async (t) => {
    const f = await fixture(t);
    const report = {
      layer: 'page',
      document: f.initial.document,
      revision: 0,
      instance: 'diagnostic',
      id: 'sponsorblock',
      status: 'active',
      error: null,
      reloadReason: null,
      diagnostics: { playback: 'ad' },
    };
    const saved = await fs.readFile(
      path.join(f.directory, 'extensions.json'),
      'utf8',
    );
    await f.engine.reportPage(report);
    assert.equal(sponsorPlayback(f.engine.snapshot().items[0]), 'ad');
    assert.equal(f.engine.snapshot().items[0].status, 'active');
    assert.equal(f.engine.snapshot().revision, 0);
    await f.engine.reportPage({
      ...report,
      diagnostics: { playback: 'ready' },
      instance: 'old-instance',
    });
    await f.engine.reportPage({
      ...report,
      diagnostics: { playback: 'invented' },
    });
    assert.equal(sponsorPlayback(f.engine.snapshot().items[0]), 'ad');
    await f.engine.reportPage({
      ...report,
      diagnostics: { playback: 'ready' },
    });
    assert.equal(sponsorPlayback(f.engine.snapshot().items[0]), 'ready');
    assert.equal(
      await fs.readFile(path.join(f.directory, 'extensions.json'), 'utf8'),
      saved,
    );
    await assert.rejects(
      f.invoke(SPONSOR_IPC.get, {
        document: f.initial.document,
        revision: 0,
        instance: 'diagnostic',
        request: 1,
        videoId,
      }),
    );
    f.engine.resetPage();
    assert.equal(sponsorPlayback(f.engine.snapshot().items[0]), null);
    await f.engine.reportPage(report);
    assert.equal(sponsorPlayback(f.engine.snapshot().items[0]), null);
  });

  test('SponsorBlock service registration and instance authority are independent of diagnostic reports', async (t) => {
    const f = await fixture(t);
    assert.throws(
      () => f.registration()(() => ({ kind: 'empty' })),
      /registration rejected/,
    );
    await f.engine.reportPage({
      layer: 'page',
      document: f.initial.document,
      revision: 0,
      instance: 'forged-active',
      id: 'sponsorblock',
      status: 'active',
      error: null,
      reloadReason: null,
    });
    await assert.rejects(
      f.invoke(SPONSOR_IPC.get, {
        document: f.initial.document,
        revision: 0,
        instance: 'forged-active',
        request: 1,
        videoId,
      }),
    );
    assert.equal(f.calls(), 0);
    const lease = await f.begin();
    assert.notEqual(lease.instance, 'forged-active');
    const request = { ...lease, request: 1, videoId };
    assert.deepEqual(await f.invoke(SPONSOR_IPC.get, request), {
      ...request,
      result: { kind: 'empty' },
    });
    assert.equal(f.calls(), 1);
    assert.ok(!JSON.stringify(f.engine.snapshot()).includes(lease.instance));
    assert.ok(!JSON.stringify(f.config()).includes(lease.instance));
    const hookEvent = { ...f.event };
    f.handlers.get(PAGE_IPC.bootstrap)(hookEvent);
    assert.ok(!JSON.stringify(hookEvent.returnValue).includes(lease.instance));
    await assert.rejects(f.begin(), /handshake rejected/);
  });

  test('main-only availability is ordered, separate from runtime and ignores stale or invalid reporters', async (t) => {
    const f = await fixture(t);
    const oldReport = f.reporter();
    const before = f.engine.snapshot();
    const configBefore = await fs.readFile(
      path.join(f.directory, 'extensions.json'),
      'utf8',
    );
    assert.equal(sponsorAvailability(before.items[0]), 'unknown');
    oldReport('network-error');
    const failure = f.engine.snapshot();
    assert.equal(sponsorAvailability(failure.items[0]), 'network-error');
    assert.equal(failure.items[0].error, null);
    assert.equal(failure.items[0].enabled, true);
    assert.equal(failure.revision, before.revision);
    assert.ok(failure.stateVersion > before.stateVersion);
    assert.equal(
      await fs.readFile(path.join(f.directory, 'extensions.json'), 'utf8'),
      configBefore,
    );
    oldReport('network-error');
    oldReport('<script>untrusted</script>');
    assert.equal(f.engine.snapshot().stateVersion, failure.stateVersion);
    oldReport('available');
    assert.equal(
      sponsorAvailability(f.engine.snapshot().items[0]),
      'available',
    );
    await f.engine.update({ id: 'sponsorblock', enabled: false });
    assert.equal(sponsorAvailability(f.engine.snapshot().items[0]), null);
    oldReport('network-error');
    assert.equal(sponsorAvailability(f.engine.snapshot().items[0]), null);
    await f.engine.update({ id: 'sponsorblock', enabled: true });
    assert.equal(sponsorAvailability(f.engine.snapshot().items[0]), 'unknown');
    oldReport('network-error');
    assert.equal(sponsorAvailability(f.engine.snapshot().items[0]), 'unknown');
    f.reporter()('service-error');
    assert.equal(
      sponsorAvailability(f.engine.snapshot().items[0]),
      'service-error',
    );
  });

  test('disabled or unregistered SponsorBlock cannot obtain a lease even after an active report', async (t) => {
    for (const options of [
      { enabled: false },
      { register: false },
      { failStart: true },
    ]) {
      await t.test(JSON.stringify(options), async (t) => {
        const f = await fixture(t, undefined, options);
        await f.engine.reportPage({
          layer: 'page',
          document: f.initial.document,
          revision: 0,
          instance: 'active',
          id: 'sponsorblock',
          status: 'active',
          error: null,
          reloadReason: null,
        });
        await assert.rejects(f.begin());
        assert.equal(f.calls(), 0);
      });
    }
  });

  test('SponsorBlock controls reject foreign senders, subframes, URLs, arity and extra fields', async (t) => {
    const f = await fixture(t);
    const payload = { document: f.initial.document, revision: 0 };
    for (const event of [
      { ...f.event, sender: {} },
      { ...f.event, senderFrame: { url: f.contents.mainFrame.url } },
    ])
      assert.throws(() => f.handlers.get(SPONSOR_IPC.begin)(event, payload));
    for (const url of [
      'https://youtube.com/tv',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/tv-evil',
      'https://www.youtube.com.evil.test/tv',
      'http://www.youtube.com/tv',
      'https://user@www.youtube.com/tv',
    ]) {
      f.contents.mainFrame.url = url;
      assert.throws(() => f.handlers.get(SPONSOR_IPC.begin)(f.event, payload));
    }
    f.contents.mainFrame.url = 'https://www.youtube.com/tv';
    for (const args of [
      [],
      [payload, payload],
      [null],
      [{ ...payload, url: 'https://evil.test' }],
      [{ ...payload, document: 'old' }],
      [{ ...payload, revision: -1 }],
    ])
      assert.throws(() => f.handlers.get(SPONSOR_IPC.begin)(f.event, ...args));
    const lease = await f.begin();
    for (const patch of [
      { instance: 'old' },
      { document: 'old' },
      { revision: -1 },
      { request: 0 },
      { request: NaN },
      { request: Number.MAX_SAFE_INTEGER + 1 },
      { videoId: 'invalid' },
      { url: 'https://evil.test' },
    ])
      await assert.rejects(
        f.invoke(SPONSOR_IPC.get, { ...lease, request: 1, videoId, ...patch }),
      );
    await f.invoke(SPONSOR_IPC.get, { ...lease, request: 1, videoId });
    await assert.rejects(
      f.invoke(SPONSOR_IPC.get, { ...lease, request: 1, videoId }),
    );
    assert.equal(f.calls(), 1);
  });

  test('revision changes cancel work and require private renewal without restarting the page instance', async (t) => {
    let signal, finish;
    const f = await fixture(t, (_id, input) => {
      signal = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const lease = await f.begin();
    const operation = f.invoke(SPONSOR_IPC.get, {
      ...lease,
      request: 1,
      videoId,
    });
    await flush();
    await f.engine.update({ id: 'sample', enabled: false });
    assert.equal(signal.aborted, true);
    assert.equal((await operation).result.kind, 'cancelled');
    finish({ kind: 'empty' });
    await assert.rejects(
      f.invoke(SPONSOR_IPC.get, { ...lease, request: 2, videoId }),
    );
    const renewed = { ...lease, revision: f.engine.snapshot().revision };
    await f.invoke(SPONSOR_IPC.renew, renewed);
    await assert.rejects(
      f.invoke(SPONSOR_IPC.renew, { ...renewed, instance: 'other' }),
    );
    const cancelled = f.invoke(SPONSOR_IPC.get, {
      ...renewed,
      request: 3,
      videoId,
    });
    await flush();
    await f.engine.update({ id: 'sponsorblock', enabled: false });
    assert.equal((await cancelled).result.kind, 'cancelled');
    await f.engine.update({ id: 'sponsorblock', enabled: true });
    const replacement = await f.begin();
    assert.notEqual(replacement.instance, lease.instance);
    assert.equal(await f.invoke(SPONSOR_IPC.end, renewed), false);
    await assert.rejects(
      f.invoke(SPONSOR_IPC.renew, { ...replacement, instance: lease.instance }),
    );
    await f.invoke(SPONSOR_IPC.end, replacement);
  });

  test('navigation, renderer loss and bridge disposal revoke pending work and tokens', async (t) => {
    for (const action of [
      'navigation',
      'render-process-gone',
      'destroyed',
      'dispose',
    ]) {
      await t.test(action, async (t) => {
        let signal;
        const f = await fixture(t, (_id, input) => {
          signal = input;
          return new Promise(() => {});
        });
        const lease = await f.begin();
        const operation = f.invoke(SPONSOR_IPC.get, {
          ...lease,
          request: 1,
          videoId,
        });
        await flush();
        if (action === 'navigation')
          f.contents.emit(
            'did-start-navigation',
            {},
            'https://www.youtube.com/tv',
            false,
            true,
          );
        else if (action === 'dispose') f.bridge.dispose();
        else f.contents.emit(action);
        assert.equal(signal.aborted, true);
        assert.equal((await operation).result.kind, 'cancelled');
        if (action !== 'dispose') {
          await assert.rejects(f.invoke(SPONSOR_IPC.renew, lease));
          assert.notEqual(f.config().document, lease.document);
        }
      });
    }
  });

  test('cancellation cannot target a foreign instance; hung handlers have a bounded lifetime', async (t) => {
    let signal;
    const f = await fixture(t, (_id, input) => {
      signal = input;
      return new Promise(() => {});
    });
    const lease = await f.begin();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const operation = f.invoke(SPONSOR_IPC.get, {
      ...lease,
      request: 1,
      videoId,
    });
    await flush();
    assert.equal(
      await f.invoke(SPONSOR_IPC.cancel, {
        ...lease,
        instance: 'foreign',
        request: 1,
      }),
      false,
    );
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(10000);
    assert.equal((await operation).result.kind, 'timeout');
    assert.equal(signal.aborted, true);
  });

  test('request concurrency and ingress are bounded; cleanup remains available after throttling', async (t) => {
    const f = await fixture(t, () => new Promise(() => {}));
    const lease = await f.begin();
    const work = Array.from({ length: 8 }, (_, index) =>
      f.invoke(SPONSOR_IPC.get, { ...lease, request: index + 1, videoId }),
    );
    assert.equal(
      (await f.invoke(SPONSOR_IPC.get, { ...lease, request: 9, videoId }))
        .result.kind,
      'busy',
    );
    for (let n = 0; n < 40; n++) {
      try {
        await f.invoke(SPONSOR_IPC.renew, lease);
      } catch {}
    }
    await assert.rejects(f.begin(), /rate limit/);
    await f.invoke(SPONSOR_IPC.cancel, { ...lease, request: 1 });
    await f.invoke(SPONSOR_IPC.end, lease);
    assert.ok(
      (await Promise.all(work)).every(
        (response) => response.result.kind === 'cancelled',
      ),
    );
  });

  test('service errors and malformed wire results do not stop the runtime', async (t) => {
    for (const handler of [
      () => {
        throw Error('offline');
      },
      () => ({
        kind: 'segments',
        segments: [{ start: -1, end: 2, videoDuration: 3 }],
      }),
    ]) {
      await t.test(handler.toString(), async (t) => {
        const f = await fixture(t, handler);
        const lease = await f.begin();
        const response = await f.invoke(SPONSOR_IPC.get, {
          ...lease,
          request: 1,
          videoId,
        });
        assert.ok(
          ['service-error', 'invalid-data'].includes(response.result.kind),
        );
        assert.equal(f.engine.snapshot().items[0].error, null);
      });
    }
  });

  test('isolated connection cancels per-film work and renews its revision', async (t) => {
    let finish;
    const f = await fixture(
      t,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const instance = new AbortController();
    const connection = createSponsorConnection(
      f.invoke,
      f.initial.document,
      0,
      instance.signal,
    );
    await connection.ready;
    const film = new AbortController();
    const operation = connection.getSponsorSegments(videoId, {
      signal: film.signal,
    });
    await flush();
    film.abort();
    assert.deepEqual(await operation, { kind: 'cancelled' });
    finish({ kind: 'empty' });
    await flush();
    await f.engine.update({ id: 'sample', enabled: false });
    connection.updateRevision(f.engine.snapshot().revision);
    await connection.ready;
    const next = connection.getSponsorSegments(videoId);
    await flush();
    instance.abort();
    assert.deepEqual(await next, { kind: 'cancelled' });
    finish({ kind: 'empty' });
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'cancelled',
    });
    await flush();
  });

  test('PageRuntime confines the capability to SponsorBlock and does not leak private instance IDs into reports', async (t) => {
    const f = await fixture(t);
    const reports = [];
    let capability,
      playbackReporter,
      starts = 0;
    const runtime = new PageRuntime(
      f.initial.document,
      {},
      {
        sponsorblock: withSponsorConnection(
          (context) => {
            starts++;
            capability = context.getSponsorSegments;
            playbackReporter = context.reportSponsorPlayback;
            assert.equal(context.readSponsorPlayer(), null);
            playbackReporter('waiting');
            return () => {};
          },
          f.invoke,
          () => null,
        ),
        sample: (context) => {
          assert.equal(context.getSponsorSegments, undefined);
          assert.equal(context.readSponsorPlayer, undefined);
          assert.equal(context.reportSponsorPlayback, undefined);
          return () => {};
        },
      },
      (report) => reports.push(report),
    );
    t.after(() => runtime.dispose());
    await runtime.apply(f.initial);
    assert.equal(
      reports.find((report) => report.id === 'sponsorblock').diagnostics
        .playback,
      'waiting',
    );
    assert.deepEqual(await capability(videoId), { kind: 'empty' });
    await f.engine.update({ id: 'sample', enabled: false });
    await runtime.apply(f.config());
    assert.deepEqual(await capability(videoId), { kind: 'empty' });
    assert.equal(starts, 1);
    assert.ok(
      reports.every((report) => !/^[a-f0-9-]{36}$/.test(report.instance)),
    );
    await runtime.dispose();
    const count = reports.length;
    playbackReporter('ready');
    assert.equal(reports.length, count);
    assert.deepEqual(await capability(videoId), { kind: 'cancelled' });
  });

  test('duplicate enable preserves the service, private lease and pending work', async (t) => {
    let finish;
    const f = await fixture(
      t,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connection = createSponsorConnection(
      f.invoke,
      f.initial.document,
      0,
      new AbortController().signal,
    );
    t.after(() => connection.dispose());
    await connection.ready;
    const pending = connection.getSponsorSegments(videoId);
    await flush();
    const service = f.engine.getService('sponsorblock');
    const before = f.engine.snapshot();
    await f.engine.update({ id: 'sponsorblock', enabled: true });
    assert.equal(f.engine.getService('sponsorblock'), service);
    assert.equal(service.abort.signal.aborted, false);
    assert.equal(f.engine.snapshot().revision, before.revision);
    finish({ kind: 'empty' });
    assert.deepEqual(await pending, { kind: 'empty' });
    const next = connection.getSponsorSegments(videoId);
    await flush();
    finish({ kind: 'empty' });
    assert.deepEqual(await next, { kind: 'empty' });
  });

  test('late handshake completion after local disposal is closed without reviving authority', async () => {
    let complete;
    const calls = [];
    const abort = new AbortController();
    const lease = {
      document: 'doc',
      revision: 0,
      instance: '12345678-1234-1234-1234-123456789abc',
    };
    const connection = createSponsorConnection(
      async (channel, payload) => {
        calls.push([channel, payload]);
        if (channel === SPONSOR_IPC.begin)
          return new Promise((resolve) => {
            complete = resolve;
          });
      },
      'doc',
      0,
      abort.signal,
    );
    await flush();
    abort.abort();
    complete(lease);
    await assert.rejects(connection.ready, /cancelled/);
    await flush();
    assert.ok(
      calls.some(
        ([channel, payload]) =>
          channel === SPONSOR_IPC.end && payload.instance === lease.instance,
      ),
    );
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'cancelled',
    });
  });

  test('rapid committed revisions recover from a superseded renewal', async (t) => {
    const f = await fixture(t);
    let release,
      gateRenewal = true;
    const connection = createSponsorConnection(
      async (channel, payload) => {
        if (channel === SPONSOR_IPC.renew && gateRenewal) {
          gateRenewal = false;
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        return f.invoke(channel, payload);
      },
      f.initial.document,
      0,
      new AbortController().signal,
    );
    t.after(() => connection.dispose());
    await connection.ready;
    await f.engine.update({ id: 'sample', enabled: false });
    connection.updateRevision(1);
    await flush();
    await f.engine.update({ id: 'sample', enabled: true });
    connection.updateRevision(2);
    release();
    await connection.ready;
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'empty',
    });
    connection.dispose();
    await flush();
  });

  test('isolated transport rejects mismatched responses and bounds a nonresponsive peer', async (t) => {
    const lease = {
      document: 'doc',
      revision: 0,
      instance: '12345678-1234-1234-1234-123456789abc',
    };
    for (const patch of [
      { videoId: 'nzUsL7VIh98' },
      { instance: 'foreign' },
      { document: 'other' },
      { revision: 9 },
      { request: 99 },
      { result: { kind: 'empty', extra: true } },
    ]) {
      const connection = createSponsorConnection(
        async (channel, payload) => {
          if (channel === SPONSOR_IPC.begin) return lease;
          if (channel === SPONSOR_IPC.get)
            return { ...payload, result: { kind: 'empty' }, ...patch };
        },
        'doc',
        0,
        new AbortController().signal,
      );
      await connection.ready;
      assert.deepEqual(await connection.getSponsorSegments(videoId), {
        kind: 'invalid-data',
      });
      connection.dispose();
    }
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const connection = createSponsorConnection(
      async (channel) => {
        if (channel === SPONSOR_IPC.begin) return lease;
        if (channel === SPONSOR_IPC.get) return new Promise(() => {});
      },
      'doc',
      0,
      new AbortController().signal,
    );
    await connection.ready;
    const work = connection.getSponsorSegments(videoId);
    await flush();
    t.mock.timers.tick(10000);
    assert.deepEqual(await work, { kind: 'timeout' });
    connection.dispose();
  });

  test('valid segment payload survives the private round trip', async (t) => {
    const expected = {
      kind: 'segments',
      segments: [{ start: 10, end: 20, videoDuration: 60 }],
    };
    const f = await fixture(t, () => expected);
    const connection = createSponsorConnection(
      f.invoke,
      f.initial.document,
      0,
      new AbortController().signal,
    );
    t.after(() => connection.dispose());
    assert.deepEqual(await connection.getSponsorSegments(videoId), expected);
    connection.dispose();
    await flush();
  });

  test('API client can serve the existing private bridge without granting page access', async (t) => {
    const {
      createSponsorApiClient,
    } = require('../src/extensions/sponsorblock/api.ts');
    let requestedPrefix;
    const api = createSponsorApiClient(async (prefix) => {
      requestedPrefix = prefix;
      return {
        kind: 'response',
        status: 200,
        body: Buffer.from(
          JSON.stringify([
            {
              videoID: videoId,
              segments: [
                {
                  segment: [3, 7],
                  category: 'sponsor',
                  actionType: 'skip',
                  videoDuration: 40,
                },
              ],
            },
          ]),
        ),
      };
    });
    const f = await fixture(t, api);
    const connection = createSponsorConnection(
      f.invoke,
      f.initial.document,
      0,
      new AbortController().signal,
    );
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'segments',
      segments: [{ start: 3, end: 7, videoDuration: 40 }],
    });
    assert.equal(requestedPrefix, '7eec');
    connection.dispose();
    await flush();
  });

  test('service failure and recovery flow through the authorized bridge into main diagnostics', async (t) => {
    const {
      createSponsorCoordinator,
    } = require('../src/extensions/sponsorblock/service.ts');
    let now = 0;
    let fail = true;
    let service;
    const f = await fixture(t, (id, signal) => service.get(id, signal));
    const coordinator = createSponsorCoordinator(
      async () =>
        fail
          ? { kind: 'network-error' }
          : { kind: 'response', status: 200, body: Buffer.from('[]') },
      { monotonic: () => now, wall: () => 0 },
    );
    service = coordinator.start((value) => f.reporter()(value));
    t.after(() => service.dispose());
    const connection = createSponsorConnection(
      f.invoke,
      f.initial.document,
      0,
      new AbortController().signal,
    );
    const revision = f.engine.snapshot().revision;
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'network-error',
    });
    assert.equal(
      sponsorAvailability(f.engine.snapshot().items[0]),
      'network-error',
    );
    assert.equal(f.engine.snapshot().items[0].error, null);
    assert.equal(f.engine.snapshot().revision, revision);
    now += 30_000;
    fail = false;
    assert.deepEqual(await connection.getSponsorSegments(videoId), {
      kind: 'empty',
    });
    assert.equal(
      sponsorAvailability(f.engine.snapshot().items[0]),
      'available',
    );
    assert.equal(f.engine.snapshot().revision, revision);
    connection.dispose();
    await flush();
    service.dispose();
  });
});

describe('Playback', () => {
  const {
    start,
    usableRanges,
  } = require('../src/extensions/sponsorblock/page.ts');
  const {
    playerBlockReason,
    readPlayerSnapshot,
  } = require('../src/extensions/sponsorblock/player.ts');
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const segment = (start = 10, end = 20, videoDuration = 100) => ({
    start,
    end,
    videoDuration,
  });

  function fixture(t, get) {
    const intervals = new Map();
    const statuses = [];
    const calls = [];
    let observer,
      now = 0,
      reads = 0,
      hook;
    class Video extends EventTarget {
      duration = 100;
      readyState = 4;
      seeking = false;
      paused = false;
      ended = false;
      time = 15;
      writes = [];
      ignoreSeek = false;
      throwSeek = false;
      emitSeekEvents = false;
      seekable = { length: 1, start: () => 0, end: () => this.duration };
      get currentTime() {
        return this.time;
      }
      set currentTime(value) {
        this.writes.push(value);
        if (this.throwSeek) throw Error('Unseekable');
        if (!this.ignoreSeek) this.time = value;
        if (this.emitSeekEvents) {
          queueMicrotask(() => {
            this.seeking = true;
            this.dispatchEvent(new Event('seeking'));
            this.seeking = false;
            this.dispatchEvent(new Event('seeked'));
          });
        }
      }
    }
    let video = new Video();
    const player = {
      querySelectorAll: () => (video ? [video] : []),
      querySelector: () => video,
    };
    const view = Object.assign(new EventTarget(), {
      location: { hash: '#/watch?v=fixture0001' },
      performance: { now: () => now },
      MutationObserver: class {
        disconnected = false;
        constructor(callback) {
          this.callback = callback;
          observer = this;
        }
        observe() {}
        disconnect() {
          this.disconnected = true;
        }
      },
      setInterval(callback) {
        intervals.set(1, callback);
        return 1;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
    });
    const document = { defaultView: view, getElementById: () => player };
    const overrides = {};
    const snapshot = () => ({
      routeId: 'fixture0001',
      videoId: 'fixture0001',
      responseId: 'fixture0001',
      live: false,
      windowedLive: false,
      liveContent: false,
      inline: false,
      adState: -1,
      adClass: false,
      state: video.paused ? 2 : 1,
      time: video.currentTime,
      duration: video.duration,
      declaredDuration: 100,
      allowSeeking: true,
      offset: 0,
      playable: true,
      ...overrides,
    });
    const abort = new AbortController();
    const dispose = start({
      document,
      signal: abort.signal,
      onCleanup() {},
      guard:
        (callback) =>
        (...args) => {
          if (!abort.signal.aborted) return callback(...args);
        },
      readSponsorPlayer: () => {
        reads++;
        hook?.(reads);
        return snapshot();
      },
      reportSponsorPlayback: (state) => statuses.push(state),
      getSponsorSegments: async (id, options) => {
        calls.push({ id, signal: options.signal });
        return get
          ? get(id, options)
          : { kind: 'segments', segments: [segment()] };
      },
    });
    t.after(dispose);
    return {
      get video() {
        return video;
      },
      view,
      overrides,
      calls,
      statuses,
      abort,
      intervals,
      get observer() {
        return observer;
      },
      tick: () => {
        for (const callback of intervals.values()) callback();
      },
      event: (name) => video.dispatchEvent(new Event(name)),
      seek(time) {
        video.time = time;
        video.seeking = true;
        video.dispatchEvent(new Event('seeking'));
        video.seeking = false;
        video.dispatchEvent(new Event('seeked'));
      },
      replace() {
        video = new Video();
        observer.callback();
      },
      change(id, event = true) {
        view.location.hash = `#/watch?v=${id}`;
        Object.assign(overrides, { routeId: id, videoId: id, responseId: id });
        if (event) view.dispatchEvent(new Event('hashchange'));
      },
      advance(ms) {
        now += ms;
      },
      onRead(callback) {
        hook = callback;
      },
      snapshot,
      dispose,
    };
  }

  test('merges overlap chains and rejects stale durations and out-of-film targets', () => {
    assert.deepEqual(
      usableRanges(
        [
          segment(20, 30),
          segment(5, 15),
          segment(14, 22),
          segment(35, 40, 100.44),
          segment(50, 101),
          segment(60, 70, 90),
        ],
        100,
      ),
      [
        { start: 5, end: 30 },
        { start: 35, end: 40 },
      ],
    );
    assert.deepEqual(usableRanges([segment(90, 100, 0)], 100), [
      { start: 90, end: 100 },
    ]);
  });

  test('starting inside a segment seeks once and confirms progress; manual rewind can skip again', async (t) => {
    const f = fixture(t);
    await flush();
    assert.deepEqual(f.video.writes, [20]);
    f.tick();
    for (let i = 0; i < 10; i++) f.tick();
    assert.deepEqual(f.video.writes, [20]);
    f.seek(12);
    assert.deepEqual(f.video.writes, [20, 20]);
    assert.equal(f.calls.length, 1);
  });

  test('a manual seek interrupting a skip does not fail later segments or a rewind', async (t) => {
    const f = fixture(t, () => ({
      kind: 'segments',
      segments: [segment(), segment(30, 40)],
    }));
    await flush();
    // Interrupt before the automatic seek has been confirmed by the next tick.
    f.seek(5);
    f.advance(5000);
    f.tick();
    assert.equal(f.statuses.at(-1), 'ready');
    f.video.time = 35;
    f.tick();
    assert.deepEqual(f.video.writes, [20, 40]);
    f.seek(12);
    assert.deepEqual(f.video.writes, [20, 40, 20]);
    assert.equal(f.calls.length, 1);
  });

  test('interrupting a skip by returning to its starting position permits a new skip', async (t) => {
    const f = fixture(t);
    await flush();
    f.seek(15);
    assert.deepEqual(f.video.writes, [20, 20]);
    f.tick();
    f.advance(5000);
    f.tick();
    assert.equal(f.statuses.at(-1), 'ready');
    assert.deepEqual(f.video.writes, [20, 20]);
  });

  test('own seeking events do not reset failed-seek protection', async (t) => {
    for (const ignoreSeek of [false, true]) {
      const f = fixture(t);
      f.video.ignoreSeek = ignoreSeek;
      f.video.emitSeekEvents = true;
      await flush();
      f.advance(5000);
      for (let i = 0; i < 10; i++) {
        f.tick();
        await flush();
      }
      assert.deepEqual(f.video.writes, [20]);
      assert.equal(f.statuses.at(-1), ignoreSeek ? 'seek-failed' : 'ready');
    }
  });

  test('a new film and a retry publish waiting before requesting segments', async (t) => {
    let calls = 0;
    const f = fixture(t, () => {
      calls++;
      if (calls > 1) assert.equal(f.statuses.at(-1), 'waiting');
      return calls === 1 ? { kind: 'empty' } : { kind: 'network-error' };
    });
    await flush();
    assert.equal(f.statuses.at(-1), 'empty');
    f.change('fixture0002');
    await flush();
    assert.equal(f.statuses.at(-1), 'retrying');
    f.advance(30000);
    f.tick();
    await flush();
    assert.equal(calls, 3);
    assert.equal(f.statuses.at(-1), 'retrying');
  });

  test('pause holds the skip; resume and speed changes use native media time', async (t) => {
    const f = fixture(t);
    f.video.paused = true;
    await flush();
    assert.deepEqual(f.video.writes, []);
    f.video.time = 11;
    f.video.playbackRate = 2;
    f.event('ratechange');
    assert.deepEqual(f.video.writes, []);
    f.video.paused = false;
    f.event('playing');
    assert.deepEqual(f.video.writes, [20]);
  });

  test('an overlapping chain skips to its union end, including a segment ending at film end', async (t) => {
    const f = fixture(t, () => ({
      kind: 'segments',
      segments: [segment(10, 20), segment(19, 30), segment(29, 100)],
    }));
    await flush();
    assert.deepEqual(f.video.writes, [100]);
    f.video.ended = true;
    f.tick();
    assert.equal(f.video.writes.length, 1);
  });

  test('ad, live, preview, unknown state and inconsistent clocks all block writes, then recover', async (t) => {
    const f = fixture(t);
    f.video.paused = true;
    await flush();
    f.video.paused = false;
    for (const invalid of [
      { adClass: true },
      { adState: 0 },
      { live: true },
      { liveContent: null },
      { inline: true },
      { inline: null },
      { offset: 2 },
      { time: 50 },
      { playable: false },
    ]) {
      Object.assign(f.overrides, invalid);
      f.tick();
      assert.deepEqual(f.video.writes, []);
      for (const key of Object.keys(invalid)) delete f.overrides[key];
    }
    f.tick();
    assert.deepEqual(f.video.writes, [20]);
  });

  test('final synchronous revalidation prevents a seek when an ad starts between observations', async (t) => {
    const f = fixture(t);
    f.onRead((read) => {
      if (read === 3) f.overrides.adClass = true;
    });
    await flush();
    assert.deepEqual(f.video.writes, []);
    assert.equal(f.statuses.at(-1), 'ad');
  });

  test('same-document A -> B -> A cancels old generations and discards delayed responses', async (t) => {
    const pending = [];
    const f = fixture(t, () => new Promise((resolve) => pending.push(resolve)));
    f.change('fixture0002');
    f.change('fixture0001');
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.calls[1].signal.aborted, true);
    pending[0]({ kind: 'segments', segments: [segment()] });
    pending[1]({ kind: 'segments', segments: [segment()] });
    await flush();
    assert.deepEqual(f.video.writes, []);
    pending[2]({ kind: 'segments', segments: [segment()] });
    await flush();
    assert.deepEqual(f.video.writes, [20]);
  });

  test('autoplay without hashchange and native media replacement invalidate old work', async (t) => {
    const pending = [];
    const f = fixture(t, () => new Promise((resolve) => pending.push(resolve)));
    const old = f.video;
    f.change('fixture0002', false);
    f.tick();
    assert.equal(f.calls[0].signal.aborted, true);
    f.replace();
    assert.equal(f.calls[1].signal.aborted, true);
    pending[0]({ kind: 'segments', segments: [segment()] });
    pending[1]({ kind: 'segments', segments: [segment()] });
    await flush();
    assert.deepEqual(old.writes, []);
    assert.deepEqual(f.video.writes, []);
    pending[2]({ kind: 'segments', segments: [segment()] });
    await flush();
    assert.deepEqual(f.video.writes, [20]);
  });

  test('leaving watch with a retained player aborts pending work and blocks late results', async (t) => {
    let finish;
    const f = fixture(
      t,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.view.location.hash = '#/';
    f.tick();
    assert.equal(f.calls[0].signal.aborted, true);
    finish({ kind: 'segments', segments: [segment()] });
    await flush();
    assert.deepEqual(f.video.writes, []);
  });

  test('failed or unconfirmed seeks never loop; disable removes timers, listeners and observers', async (t) => {
    const f = fixture(t);
    f.video.ignoreSeek = true;
    await flush();
    f.advance(5000);
    for (let i = 0; i < 10; i++) f.tick();
    assert.deepEqual(f.video.writes, [20]);
    assert.equal(f.statuses.at(-1), 'seek-failed');
    f.abort.abort();
    assert.equal(f.observer.disconnected, true);
    assert.equal(f.intervals.size, 0);
    const reports = f.statuses.length;
    f.event('playing');
    f.view.dispatchEvent(new Event('hashchange'));
    assert.equal(f.statuses.length, reports);
    assert.equal(f.calls.length, 1);
  });

  test('disabling during a request cancels it and prevents every later seek', async (t) => {
    let finish;
    const f = fixture(
      t,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.abort.abort();
    assert.equal(f.calls[0].signal.aborted, true);
    finish({ kind: 'segments', segments: [segment()] });
    await flush();
    f.tick();
    assert.deepEqual(f.video.writes, []);
  });

  test('API failure and empty results keep playback running without request loops', async (t) => {
    for (const result of [{ kind: 'network-error' }, { kind: 'empty' }]) {
      const f = fixture(t, () => result);
      await flush();
      for (let i = 0; i < 10; i++) f.tick();
      assert.equal(f.calls.length, 1);
      assert.deepEqual(f.video.writes, []);
      assert.equal(f.video.paused, false);
    }
  });

  test('a transient failure retries after cooldown and recovers on the same video', async (t) => {
    let calls = 0;
    const f = fixture(t, () =>
      ++calls === 1
        ? { kind: 'network-error' }
        : { kind: 'segments', segments: [segment()] },
    );
    await flush();
    assert.equal(f.statuses.at(-1), 'retrying');
    f.advance(29999);
    f.tick();
    await flush();
    assert.equal(calls, 1);
    f.advance(1);
    f.tick();
    await flush();
    assert.equal(calls, 2);
    assert.deepEqual(f.video.writes, [20]);
    assert.equal(f.statuses.at(-1), 'ready');
  });

  test('retries respect Retry-After, have a finite budget and expose exhaustion', async (t) => {
    const f = fixture(t, () => ({
      kind: 'rate-limited',
      retryAfterMs: 120000,
    }));
    await flush();
    f.advance(119999);
    f.tick();
    await flush();
    assert.equal(f.calls.length, 1);
    f.advance(1);
    f.tick();
    await flush();
    assert.equal(f.calls.length, 2);
    for (let i = 0; i < 2; i++) {
      f.advance(120000);
      f.tick();
      await flush();
    }
    assert.equal(f.calls.length, 4);
    assert.equal(f.statuses.at(-1), 'request-error');
    f.advance(1e9);
    f.tick();
    await flush();
    assert.equal(f.calls.length, 4);
    const long = fixture(t, () => ({
      kind: 'rate-limited',
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    }));
    await flush();
    long.advance(1e9);
    long.tick();
    await flush();
    assert.equal(long.calls.length, 1);
  });

  test('disable and a new video discard scheduled retries; invalid data is not retried', async (t) => {
    const f = fixture(t, () => ({ kind: 'network-error' }));
    await flush();
    f.change('fixture0002');
    await flush();
    f.advance(30000);
    f.tick();
    await flush();
    assert.deepEqual(
      f.calls.map((call) => call.id),
      ['fixture0001', 'fixture0002', 'fixture0002'],
    );
    f.abort.abort();
    f.advance(1e9);
    f.tick();
    await flush();
    assert.equal(f.calls.length, 3);
    const invalid = fixture(t, () => ({ kind: 'invalid-data' }));
    await flush();
    invalid.advance(1e9);
    invalid.tick();
    await flush();
    assert.equal(invalid.calls.length, 1);
    assert.equal(invalid.statuses.at(-1), 'request-error');
  });

  test('invalid lengths and unavailable seek targets are visible and do not move playback', async (t) => {
    const f = fixture(t, () => ({
      kind: 'segments',
      segments: [segment(10, 20, 70)],
    }));
    await flush();
    assert.equal(f.statuses.at(-1), 'invalid-segments');
    assert.deepEqual(f.video.writes, []);
    const g = fixture(t);
    g.video.seekable.length = 0;
    await flush();
    assert.equal(g.statuses.at(-1), 'not-ready');
    assert.deepEqual(g.video.writes, []);
  });

  test('unknown or malformed snapshot values cannot authorize playback', async (t) => {
    const f = fixture(t);
    f.video.paused = true;
    await flush();
    assert.equal(playerBlockReason(null, f.video), 'player-api');
    assert.equal(
      playerBlockReason({ ...f.snapshot(), duration: '100' }, f.video),
      'timeline',
    );
    assert.equal(
      playerBlockReason({ ...f.snapshot(), adClass: undefined }, f.video),
      'ad',
    );
    assert.equal(
      playerBlockReason({ ...f.snapshot(), videoId: 'fixture0002' }, f.video),
      'identity',
    );
  });

  test('main-world adapter survives serialization and returns only bounded data', () => {
    const vm = require('node:vm');
    const player = {
      getVideoData: () => ({
        video_id: 'fixture0001',
        isLive: false,
        isWindowedLive: false,
      }),
      getPlayerResponse: () => ({
        videoDetails: {
          videoId: 'fixture0001',
          isLiveContent: false,
          lengthSeconds: '100',
        },
        playabilityStatus: { status: 'OK' },
      }),
      getProgressState: () => ({ allowSeeking: true, offset: 0 }),
      isInline: () => false,
      getAdState: () => -1,
      getPlayerState: () => 1,
      getCurrentTime: () => 12,
      getDuration: () => 100,
      classList: { contains: () => false },
    };
    const sandbox = {
      document: { getElementById: () => player },
      location: { hash: '#/watch?v=fixture0001' },
      URLSearchParams,
    };
    const sample = vm.runInNewContext(
      `(${readPlayerSnapshot.toString()})()`,
      sandbox,
    );
    assert.equal(sample.videoId, 'fixture0001');
    assert.equal(sample.playable, true);
    assert.ok(
      Object.values(sample).every(
        (value) =>
          value === null ||
          ['string', 'number', 'boolean'].includes(typeof value),
      ),
    );
    player.getCurrentTime = () => {
      throw Error('Unavailable');
    };
    assert.equal(
      vm.runInNewContext(`(${readPlayerSnapshot.toString()})()`, sandbox),
      null,
    );
  });

  test('revision cancellation can resume once, without looping on repeated cancellation', async (t) => {
    let requests = 0;
    const f = fixture(t, () =>
      ++requests === 1
        ? { kind: 'cancelled' }
        : { kind: 'segments', segments: [segment()] },
    );
    await flush();
    assert.equal(requests, 2);
    assert.deepEqual(f.video.writes, [20]);
    const g = fixture(t, () => ({ kind: 'cancelled' }));
    await flush();
    for (let i = 0; i < 10; i++) g.tick();
    assert.equal(g.calls.length, 2);
  });
});
