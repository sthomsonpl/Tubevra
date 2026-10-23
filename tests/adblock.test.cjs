const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

let factory;
before(async () => {
  const { buildHookEntry } = await import('../build/extensions.mjs');
  const source = await buildHookEntry();
  factory = vm.runInNewContext(
    source.replace('export function', 'function') + '; hookEntry.toString()',
  );
});
const ads = () => ({
  adPlacements: [{ adPlacementRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }, { adSlotRenderer: {} }],
});
const player = (extra = {}) => ({
  playabilityStatus: { status: 'OK' },
  streamingData: { formats: [{ url: 'fixture-stream' }] },
  captions: { fixture: true },
  videoDetails: { videoId: 'fixture' },
  paidContentOverlay: { fixture: true },
  ...extra,
});
function runtime({ enabled = true, setup = '' } = {}) {
  const realm = vm.createContext({ AbortController });
  const run = (source) => vm.runInContext(source, realm);
  run('globalThis.nativeParse = JSON.parse');
  if (setup) run(setup);
  run('globalThis.originalParse = JSON.parse');
  realm.initial = {
    document: 'adblock-test',
    revision: 0,
    items: [],
    hooks: [{ id: 'adblock', enabled }],
  };
  const control = run(`(${factory})(initial)`);
  return {
    realm,
    run,
    control,
    parse(input) {
      realm.text = JSON.stringify(input);
      return JSON.parse(run('JSON.stringify(JSON.parse(text))'));
    },
    toggle(revision, enabled) {
      control.apply({
        ...realm.initial,
        revision,
        hooks: [{ id: 'adblock', enabled }],
      });
    },
  };
}

test('serialized production module clears both ad fields and preserves player data', () => {
  const r = runtime();
  const input = player({ ...ads(), playerAds: [{ untouched: true }] });
  assert.deepEqual(r.parse(input), { ...input, adPlacements: [], adSlots: [] });
  const report = r.control.drain().at(-1);
  assert.equal(report.status, 'active');
  assert.match(report.reloadReason, /changed player data/);
  r.control.dispose();
});

test('single supported field is sufficient and empty arrays need no reload', () => {
  for (const field of ['adPlacements', 'adSlots']) {
    const r = runtime();
    assert.deepEqual(
      r.parse(player({ [field]: ads()[field] })),
      player({ [field]: [] }),
    );
    r.control.dispose();
  }
  const r = runtime();
  assert.deepEqual(
    r.parse(player({ adPlacements: [], adSlots: [] })),
    player({ adPlacements: [], adSlots: [] }),
  );
  assert.equal(
    r.control.drain().some((report) => report.reloadReason),
    false,
  );
  r.control.dispose();
});

test('transformation is idempotent and reload is reported only on the first change', () => {
  const r = runtime();
  const result = r.parse(player(ads()));
  assert.deepEqual(r.parse(result), result);
  r.parse(player(ads()));
  assert.equal(
    r.control.drain().filter((report) => report.reloadReason).length,
    1,
  );
  r.control.dispose();
});

test('primitives, arrays, incomplete and nested player structures remain untouched', () => {
  const r = runtime();
  for (const input of [
    null,
    true,
    false,
    1,
    'text',
    [],
    [player(ads())],
    {},
    player(),
    { ...ads() },
    { playabilityStatus: {}, ...ads() },
    { streamingData: {}, ...ads() },
    { playabilityStatus: [], streamingData: {}, ...ads() },
    { playabilityStatus: {}, streamingData: null, ...ads() },
    { playerResponse: player(ads()) },
  ]) {
    assert.deepEqual(r.parse(input), input);
  }
  assert.equal(
    r.control.drain().some((report) => report.reloadReason || report.error),
    false,
  );
  r.control.dispose();
});

test('unconfirmed feed, continuation, secondary navigation and Shorts ads remain untouched', () => {
  const r = runtime();
  const items = [
    { videoRenderer: { videoId: 'fixture' } },
    { adSlotRenderer: {} },
  ];
  for (const input of [
    {
      contents: {
        tvBrowseRenderer: {
          content: {
            tvSurfaceContentRenderer: {
              content: { sectionListRenderer: { contents: items } },
            },
          },
        },
      },
    },
    {
      continuationContents: {
        sectionListContinuation: { contents: items },
        horizontalListContinuation: { items },
      },
    },
    {
      contents: {
        singleColumnWatchNextResults: {
          pivot: {
            sectionListRenderer: {
              contents: [
                {
                  shelfRenderer: {
                    content: { horizontalListRenderer: { items } },
                  },
                },
              ],
            },
          },
        },
      },
    },
    { tvSecondaryNavRenderer: { sections: items } },
    {
      entries: [true, false, null, 1, 'true'].map((isAd) => ({
        command: { reelWatchEndpoint: { adClientParams: { isAd } } },
      })),
    },
  ])
    assert.deepEqual(r.parse(input), input);
  assert.equal(
    r.control.drain().some((report) => report.reloadReason || report.error),
    false,
  );
  r.control.dispose();
});

test('all fields are validated before mutation; incompatible data reports and detaches', () => {
  for (const field of ['adPlacements', 'adSlots']) {
    for (const value of [
      null,
      false,
      {},
      [null],
      [{}],
      [{ adSlotRenderer: null }],
      [...ads()[field], { videoRenderer: {} }],
    ]) {
      const r = runtime();
      const input = player({ ...ads(), [field]: value });
      assert.deepEqual(r.parse(input), input);
      const report = r.control.drain().at(-1);
      assert.equal(report.status, 'error');
      assert.match(report.error, new RegExp('incompatible.*' + field));
      assert.equal(report.reloadReason, null);
      assert.equal(r.run('JSON.parse === originalParse'), true);
    }
  }
});

test('parser forwards receiver, all arguments, reviver and original exception exactly once', () => {
  const r = runtime({
    setup: `globalThis.calls = 0; globalThis.sentinel = {};
    JSON.parse = function (...args) {
      calls++; globalThis.receiver = this; globalThis.argumentsCount = args.length;
      if (args[0] === 'throw') throw sentinel;
      return Reflect.apply(nativeParse, this, args);
    };`,
  });
  assert.equal(
    r.run(`JSON.parse.call(sentinel, '{"value":1}',
    (key, value) => key === 'value' ? 7 : value, 'extra').value`),
    7,
  );
  assert.equal(
    r.run('receiver === sentinel && argumentsCount === 3 && calls === 1'),
    true,
  );
  assert.equal(
    r.run(`(() => {try {JSON.parse('throw');} catch (error) {
    return error === sentinel && calls === 2;
  }})()`),
    true,
  );
  assert.equal(r.control.drain().at(-1).status, 'active');
  r.control.dispose();
});

test('native syntax errors and reviver errors propagate without stopping Adblock', () => {
  const r = runtime();
  assert.throws(() => r.run('JSON.parse("{")'), { name: 'SyntaxError' });
  assert.equal(
    r.run(`globalThis.sentinel = {}; (() => {
    try {JSON.parse('{}', () => {throw sentinel;});} catch (error) {return error === sentinel;}
  })()`),
    true,
  );
  assert.deepEqual(
    r.parse(player(ads())),
    player({ adPlacements: [], adSlots: [] }),
  );
  r.control.dispose();
});

test('reviver results are filtered after revival and otherwise keep their identity', () => {
  const r = runtime();
  r.realm.text = JSON.stringify(player(ads()));
  assert.equal(
    r.run(`globalThis.revived = undefined;
    globalThis.result = JSON.parse(text, (key, value) => {
      if (key === '') {value.captions.fixture = 'revived'; globalThis.revived = value;}
      return value;
    }); result === revived && result.adSlots.length === 0 && result.captions.fixture === 'revived'`),
    true,
  );
  r.control.dispose();
});

test('inherited signatures and sparse or inherited renderer entries are not trusted', () => {
  const r = runtime();
  r.realm.text = JSON.stringify(player(ads()));
  assert.equal(
    r.run(`JSON.parse(text, (key,value) => {
    if (key === '') {const inherited = Object.create({streamingData:value.streamingData});
      delete value.streamingData; return Object.assign(inherited,value);}
    return value;
  }).adSlots.length`),
    2,
  );
  assert.equal(
    r.control.drain().some((report) => report.reloadReason || report.error),
    false,
  );
  r.control.dispose();
  for (const reviver of [
    `(key,value) => key === 'adSlotRenderer' ? undefined : value`,
    `(key,value) => key === 'adSlots' ? new Array(1) : value`,
    `(key,value) => key === 'adSlots' ? [Object.create({adSlotRenderer:{}})] : value`,
  ]) {
    const current = runtime();
    current.realm.text = r.realm.text;
    current.run(`JSON.parse(text, ${reviver})`);
    assert.match(current.control.drain().at(-1).error, /incompatible.*adSlots/);
    assert.equal(current.run('JSON.parse === originalParse'), true);
  }
});

test('write failure reports transformation error without a second parser call', () => {
  const r = runtime({
    setup: `globalThis.calls = 0; JSON.parse = function(...args) {
    calls++; return Reflect.apply(nativeParse,this,args);
  };`,
  });
  r.realm.text = JSON.stringify(player(ads()));
  assert.throws(
    () =>
      r.run(
        `JSON.parse(text, (key,value) => key === '' ? Object.freeze(value) : value)`,
      ),
    /cannot clear/,
  );
  assert.equal(r.run('calls'), 1);
  assert.match(r.control.drain().at(-1).error, /cannot clear/);
  assert.equal(r.run('JSON.parse === originalParse'), true);
});

test('reload survives an error after partial mutation', () => {
  const r = runtime();
  r.realm.text = JSON.stringify(player(ads()));
  assert.throws(
    () =>
      r.run(`JSON.parse(text, (key,value) => {
    if (key === '') Object.defineProperty(value,'adSlots',{writable:false});
    return value;
  })`),
    /cannot clear.*adSlots/,
  );
  const report = r.control.drain().at(-1);
  assert.equal(report.status, 'error');
  assert.ok(report.reloadReason);
});

test('disable restores the descriptor and stops retained wrappers while keeping reload', () => {
  const r = runtime();
  r.parse(player(ads()));
  r.run('globalThis.retained = JSON.parse');
  r.toggle(1, false);
  assert.equal(r.run('JSON.parse === originalParse'), true);
  r.realm.text = JSON.stringify(player(ads()));
  assert.equal(r.run('retained(text).adSlots.length'), 2);
  assert.ok(r.control.drain().at(-1).reloadReason);
  r.toggle(2, true);
  assert.equal(r.run('JSON.parse === originalParse'), true);
  assert.match(r.control.drain().at(-1).reloadReason, /new document/);
  r.control.dispose();
  const next = runtime();
  assert.deepEqual(
    next.parse(player(ads())),
    player({ adPlacements: [], adSlots: [] }),
  );
  next.control.dispose();
});

test('initially disabled Adblock defers installation until a new document', () => {
  const r = runtime({ enabled: false });
  assert.deepEqual(r.parse(player(ads())), player(ads()));
  r.toggle(1, true);
  assert.equal(r.run('JSON.parse === originalParse'), true);
  assert.match(r.control.drain().at(-1).reloadReason, /new document/);
  r.control.dispose();
});

test('abort during the original parser prevents subsequent transformation', () => {
  const r = runtime();
  r.realm.text = JSON.stringify(player(ads()));
  r.realm.disable = () => r.toggle(1, false);
  assert.equal(
    r.run(`JSON.parse(text, (key,value) => {
    if (key === '') disable();
    return value;
  }).adSlots.length`),
    2,
  );
  assert.equal(r.run('JSON.parse === originalParse'), true);
  assert.equal(
    r.control.drain().some((report) => report.reloadReason),
    false,
  );
  r.control.dispose();
});

test('cleanup conflict preserves another owner and requests reload', () => {
  const r = runtime();
  r.run('JSON.parse = function other() {}; globalThis.other = JSON.parse');
  r.toggle(1, false);
  assert.equal(r.run('JSON.parse === other'), true);
  const report = r.control.drain().at(-1);
  assert.match(report.error, /restoration conflict/);
  assert.ok(report.reloadReason);
});

test('a second module cannot acquire the parser already owned by Adblock', async () => {
  const { buildHookEntry } = await import('../build/extensions.mjs');
  const { adblock } = await import('../src/extensions/adblock/adblock.ts');
  const source = await buildHookEntry([adblock, { ...adblock, id: 'second' }]);
  const entry = vm.runInNewContext(
    source.replace('export function', 'function') + ';hookEntry',
    { AbortController },
  );
  const control = entry({
    document: 'conflict',
    revision: 0,
    items: [],
    hooks: [
      { id: 'adblock', enabled: true },
      { id: 'second', enabled: true },
    ],
  });
  const reports = control.drain();
  assert.equal(
    reports.find((report) => report.id === 'adblock').status,
    'active',
  );
  assert.match(
    reports.find(
      (report) => report.id === 'second' && report.status === 'error',
    ).error,
    /Conflicting hook target/,
  );
  control.dispose();
});
