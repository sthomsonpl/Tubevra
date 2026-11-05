const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(
  fs.readFileSync('src/preload/cobalt-media-capabilities.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exportsObject = {};
const shared = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync('src/shared/media-capabilities.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: shared },
);
vm.runInNewContext(source, {
  exports: exportsObject,
  require: (name) => (name === '../shared/media-capabilities' ? shared : {}),
});
const {
  hasCobaltUserAgent,
  cobaltMediaLimits,
  overrideCobaltMediaCapabilities,
} = exportsObject;
function fixture(
  display = { width: 1920, height: 1080 },
  hdr = false,
  hardwareProfiles = null,
  preferences = shared.DEFAULT_CODEC_PREFERENCES,
  nativeCheck = null,
) {
  const calls = [];
  const native = function (type) {
    calls.push(type);
    if (type === 'throw') throw Error('native failure');
    return nativeCheck
      ? nativeCheck(type)
      : !String(type).includes('nonexistent');
  };
  const context = {
    MediaSource: { isTypeSupported: native },
    window: { matchMedia: () => ({ matches: hdr }) },
    limits: cobaltMediaLimits(display),
    hardwareProfiles,
    preferences,
  };
  vm.createContext(context);
  const control = vm.runInContext(
    `(${overrideCobaltMediaCapabilities.toString()})(limits, hardwareProfiles, preferences)`,
    context,
  );
  return {
    context,
    calls,
    control,
    check: (type) => context.MediaSource.isTypeSupported(type),
  };
}
const vp9 = 'video/webm; codecs="vp9"';

test('manual selection filters families independently of detection, preserving H264 and native rejection', () => {
  for (const hardware of [null, [], ['av1 profile main', 'h264 high']]) {
    for (const allowedCodecs of [[], ['vp9'], ['av1'], ['vp9', 'av1']]) {
      const f = fixture(undefined, false, hardware, {
        mode: 'manual',
        allowedCodecs,
      });
      assert.equal(
        f.check(vp9),
        allowedCodecs.includes('vp9') && hardware === null,
      );
      assert.equal(
        f.check('video/mp4;codecs="av01.0.13M.08"'),
        allowedCodecs.includes('av1') &&
          (hardware === null || hardware.includes('av1 profile main')),
      );
      assert.equal(
        f.check('video/mp4;codecs="avc1.640028"'),
        hardware === null || hardware.includes('h264 high'),
      );
      assert.equal(f.check('audio/webm;codecs="opus"'), true);
      assert.equal(
        f.check('video/webm;codecs="vp09.09.10.08"'),
        allowedCodecs.includes('vp9'),
      );
    }
  }
  const f = fixture(
    undefined,
    false,
    null,
    { mode: 'manual', allowedCodecs: ['av1'] },
    () => false,
  );
  assert.equal(f.check('video/mp4;codecs="av01.0.13M.08"'), false);
});

test('force bypasses selected codec rejection only within its validated scope', () => {
  const native = (type) => /codecs="(?:avc1\.42E01E|vp8)"$/.test(type);
  const f = fixture(
    undefined,
    false,
    [],
    { mode: 'force', allowedCodecs: ['vp9', 'av1'] },
    native,
  );
  for (const query of [
    vp9,
    'video/mp4;codecs="vp09.02.51.10";width=640',
    'video/mp4;codecs="av01.0.13M.08";framerate=60',
  ])
    assert.equal(f.check(query), true, query);
  for (const query of [
    'video/unknown;codecs="av01.0.13M.08"',
    'audio/mp4;codecs="av01.0.13M.08"',
    'video/mp4;codecs="av01.0.13M.08";unknown=1',
    'video/mp4;codecs="av01.0.13M.08";width=99999',
    'video/mp4;codecs="av01.0.13M.08";framerate=61',
    'video/mp4;codecs="av01.0.13M.08";eotf=smpte2084',
    'video/mp4;codecs="av01.0.13M.08";width=640;width=640',
    'video/mp4;codecs="av01.0.13M.08";codecs="av01.0.13M.08"',
    'video/mp4;codecs="av01.0.13M.08,mp4a.40.2"',
    'video/mp4;codecs="av01.0.13M.08,nonexistent"',
    'video/mp4;codecs="av01.0.99M.08"',
    'video/mp4;codecs="av01.0.13M.12"',
    'video/mp4;codecs="av01.0.01H.08"',
    'video/mp4;codecs="vp09.00.51.10"',
    'video/mp4;codecs="vp09.02.99.10"',
    'video/mp4;codecs="av01.0.13M.08.0.110.01.01.01.0"',
    'video/mp4;codecs="avc1.640028"',
  ])
    assert.equal(f.check(query), false, query);
  assert.match(f.control.takeWarning(), /Force scope/);
  const blocked = fixture(undefined, false, null, {
    mode: 'force',
    allowedCodecs: [],
  });
  assert.equal(blocked.check(vp9), false);
  assert.equal(blocked.check('video/mp4;codecs="avc1.640028"'), true);
  const noContainer = fixture(
    undefined,
    false,
    null,
    { mode: 'force', allowedCodecs: ['av1'] },
    () => false,
  );
  assert.equal(noContainer.check('video/mp4;codecs="av01.0.13M.08"'), false);
});
test('installation guards run before bootstrap and propagate installation errors', () => {
  for (const [main, url, ua, expected] of [
    [true, 'https://www.youtube.com/tv', 'Cobalt/26', 1],
    [false, 'https://www.youtube.com/tv', 'Cobalt/26', 0],
    [true, 'https://www.youtube.com/', 'Cobalt/26', 0],
    [true, 'file:///shell.html', 'Cobalt/26', 0],
    [true, 'https://www.youtube.com/tv', 'Chrome/156', 0],
  ]) {
    let bootstraps = 0,
      installs = 0;
    const out = {};
    const context = {
      exports: out,
      process: { isMainFrame: main },
      location: { href: url },
      navigator: { userAgent: ua },
      require: (name) => {
        if (name === '../shared/media-capabilities') return shared;
        if (name === 'electron')
          return {
            contextBridge: {
              executeInMainWorld() {
                installs++;
                throw Error('installation failed');
              },
            },
          };
        if (name === './tv-display')
          return {
            bootstrapTVDisplay() {
              bootstraps++;
              return { width: 1920, height: 1080 };
            },
          };
        if (name === './media-capabilities')
          return {
            bootstrapHardwareCodecs: () => ({
              status: 'disabled',
              profiles: [],
            }),
          };
        return {
          isTVDisplayURL: (value) => value === 'https://www.youtube.com/tv',
        };
      },
    };
    vm.runInNewContext(source, context);
    if (expected)
      assert.throws(
        () => out.installCobaltMediaCapabilities(),
        /installation failed/,
      );
    else out.installCobaltMediaCapabilities();
    assert.equal(bootstraps, expected);
    assert.equal(installs, expected);
  }
});
test('matches actual Cobalt product tokens including custom UA', () => {
  for (const ua of [
    'Mozilla/5.0 (PS4) Cobalt/26.lts; compatible;',
    'custom cobalt/27',
    'Cobalt/24',
  ])
    assert.equal(hasCobaltUserAgent(ua), true);
  for (const ua of [
    'Chrome/156',
    'NotCobalt/26',
    'Cobalt',
    'Cobalt/',
    'Cobalt/no-version',
  ])
    assert.equal(hasCobaltUserAgent(ua), false);
});
test('observed YouTube probes distinguish valid and invalid configurations', () => {
  const f = fixture();
  for (const [key, good, bad] of [
    ['width', '640', '99999'],
    ['height', '360', '99999'],
    ['framerate', '30', '9999'],
    ['bitrate', '300000', '2000000000'],
    ['channels', '2', '99'],
    ['eotf', 'bt709', 'catavision'],
    ['cryptoblockformat', 'subsample', 'invalidformat'],
    ['decode-to-texture', 'false', 'nope'],
  ]) {
    assert.equal(f.check(`${vp9}; ${key}=${good}`), true, key);
    assert.equal(f.check(`${vp9}; ${key}=${bad}`), false, key);
  }
});
test('physical monitor boundaries, orientations and fractional FPS', () => {
  for (const display of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
    { width: 1080, height: 1920 },
    { width: 3440, height: 1440 },
  ]) {
    const f = fixture(display);
    assert.equal(
      f.check(
        `${vp9};width=${display.width};height=${display.height};framerate=59.94`,
      ),
      true,
    );
    assert.equal(f.check(`${vp9};width=${display.width + 1}`), false);
    assert.equal(f.check(`${vp9};height=${display.height + 1}`), false);
  }
  assert.equal(fixture().check(`${vp9};framerate=60`), true);
  assert.equal(fixture().check(`${vp9};framerate=60.01`), false);
});
test('quotes, malformed values, duplicates and unknown parameters', () => {
  const f = fixture();
  assert.equal(f.check(`${vp9}; WIDTH = "1280" ; height=720`), true);
  for (const tail of [
    'width=NaN',
    'width=Infinity',
    'width=-1',
    'width=0',
    'width=1.5',
    'width=1e3',
    'width=',
    'width',
    'width="640',
    'width=640;width=640',
  ])
    assert.equal(f.check(`${vp9};${tail}`), false, tail);
  const unchanged = `${vp9}; experimental="a;b";tunnelmode=true`;
  assert.equal(f.check(unchanged), true);
  assert.equal(f.calls.at(-1), unchanged);
  assert.equal(f.check(`${unchanged};width=640`), true);
  assert.equal(f.calls.at(-1), unchanged);
});
test('native codec decisions, exceptions, conversion and single installation', () => {
  const f = fixture();
  assert.equal(f.check('video/webm;codecs="nonexistent";width=640'), false);
  assert.throws(() => f.check('throw'), /native failure/);
  assert.throws(() => f.check(Symbol('type')), /Symbol/);
  let conversions = 0;
  assert.equal(
    f.check({
      toString() {
        conversions++;
        return vp9;
      },
    }),
    true,
  );
  assert.equal(conversions, 1);
  const installed = f.context.MediaSource.isTypeSupported;
  vm.runInContext(
    `(${overrideCobaltMediaCapabilities.toString()})(limits)`,
    f.context,
  );
  assert.equal(f.context.MediaSource.isTypeSupported, installed);
});
test('HDR transfer values require HDR display; invalid limits and locked API throw', () => {
  assert.equal(fixture().check(`${vp9};eotf=smpte2084`), false);
  assert.equal(fixture(undefined, true).check(`${vp9};eotf=smpte2084`), true);
  const c = fixture();
  c.context.limits.width = 0;
  assert.throws(
    () =>
      vm.runInContext(
        `(${overrideCobaltMediaCapabilities.toString()})(limits)`,
        c.context,
      ),
    /Invalid Cobalt/,
  );
  const locked = {
    MediaSource: {},
    limits: cobaltMediaLimits({ width: 1920, height: 1080 }),
  };
  Object.defineProperty(locked.MediaSource, 'isTypeSupported', {
    value: () => true,
  });
  assert.throws(
    () =>
      vm.runInNewContext(
        `(${overrideCobaltMediaCapabilities.toString()})(limits)`,
        locked,
      ),
    /redefine/,
  );
});

test('hardware profiles filter AV1, VP9 and AVC while retaining native validation and limits', () => {
  const f = fixture({ width: 3840, height: 2160 }, false, [
    'vp9 profile0',
    'vp9 profile2',
    'h264 baseline',
    'h264 high',
  ]);
  for (const codec of [
    'vp9',
    'vp9.0',
    'vp09.00.51.08',
    'vp09.02.51.10',
    'avc1.42001e',
    'avc3.640033',
  ])
    assert.equal(
      f.check(`video/mp4;codecs="${codec}";width=3840;framerate=60`),
      true,
      codec,
    );
  for (const codec of [
    'av01.0.13M.08',
    'av01.0.13M.10.0.112.09.16.09.0',
    'vp09.01.51.08',
    'vp09.03.51.10',
    'avc1.4d0033',
    'avc1.6e0033',
  ])
    assert.equal(
      f.check(`video/mp4;codecs="${codec}";width=640`),
      false,
      codec,
    );
  assert.equal(f.check(`${vp9};width=99999`), false);
  assert.equal(f.check('video/mp4;codecs="vp09.00.51.08,nonexistent"'), false);
  assert.equal(f.check('video/mp4;codecs="avc1.640033,av01.0.13M.08"'), false);
  assert.equal(f.control.takeWarning(), null);
});

test('AV1 hardware profiles are independent; native failure is never overridden', () => {
  const main = fixture(undefined, false, ['av1 profile main']);
  assert.equal(main.check('video/mp4;codecs="av01.0.13M.08"'), true);
  assert.equal(main.check('video/mp4;codecs="av01.0.13M.10"'), true);
  assert.equal(main.check('video/mp4;codecs="av01.1.13M.08"'), false);
  assert.equal(main.check('video/mp4;codecs="av01.2.13M.12"'), false);
  assert.equal(
    main.check('video/mp4;codecs="av01.0.13M.08,nonexistent"'),
    false,
  );
  assert.equal(fixture(undefined, false, []).check(vp9), false);
});

test('unmapped target profiles use native behavior with a diagnostic; other types remain native', () => {
  const f = fixture(undefined, false, []);
  assert.equal(f.check('video/mp4;codecs="avc1.ff0033"'), true);
  assert.match(f.control.takeWarning(), /Unrecognized video codec profile/);
  assert.equal(f.control.takeWarning(), null);
  for (const mime of [
    'audio/mp4;codecs="mp4a.40.2"',
    'video/webm;codecs="vp8"',
    'video/mp4',
    'audio/mp4;codecs="av01.0.13M.08"',
  ])
    assert.equal(f.check(mime), true, mime);
  assert.equal(f.control.takeWarning(), null);
});

test('native fallback without hardware data retains supported software formats', () => {
  const f = fixture();
  assert.equal(f.check('video/mp4;codecs="av01.0.13M.08";framerate=60'), true);
  assert.equal(f.check('video/mp4;codecs="av01.0.13M.08";framerate=61'), false);
  assert.equal(f.control.takeWarning(), null);
});

test('installer passes only ready profiles and reports unknown-profile warnings without exposing an API', () => {
  for (const snapshot of [
    { status: 'ready', profiles: ['vp9 profile2'] },
    { status: 'disabled', profiles: [] },
    { status: 'error', error: 'test' },
  ]) {
    let args,
      tick,
      pagehide,
      cleared = 0;
    const messages = [],
      out = {};
    vm.runInNewContext(source, {
      exports: out,
      process: { isMainFrame: true },
      location: { href: 'https://www.youtube.com/tv' },
      navigator: { userAgent: 'Cobalt/26' },
      window: {
        addEventListener: (event, callback) => {
          assert.equal(event, 'pagehide');
          pagehide = callback;
        },
      },
      setInterval: (callback, delay) => {
        tick = callback;
        assert.equal(delay, 1000);
        return 1;
      },
      clearInterval: () => {
        cleared++;
      },
      require: (name) => {
        if (name === '../shared/media-capabilities') return shared;
        if (name === '../shared/tv-display')
          return { isTVDisplayURL: () => true };
        if (name === './media-capabilities')
          return {
            bootstrapHardwareCodecs: () => ({
              preferences: shared.DEFAULT_CODEC_PREFERENCES,
              hardware: snapshot,
            }),
          };
        if (name === './tv-display')
          return { bootstrapTVDisplay: () => ({ width: 1920, height: 1080 }) };
        if (name === 'electron')
          return {
            contextBridge: {
              executeInMainWorld: (options) => {
                args = options.args;
                return { takeWarning: () => 'Unrecognized profile' };
              },
            },
            ipcRenderer: { send: (...values) => messages.push(values) },
          };
      },
    });
    out.installCobaltMediaCapabilities();
    assert.equal(
      args[1],
      snapshot.status === 'ready' ? snapshot.profiles : null,
    );
    {
      tick();
      assert.equal(messages[0][0], shared.HARDWARE_CODECS_IPC.failure);
      pagehide();
      assert.equal(cleared, 2);
    }
  }
});

test('Electron runner rejects timeouts and missing results even with exit status zero', () => {
  const path = require('node:path');
  const runner = fs.readFileSync('tests/electron/run.cjs', 'utf8');
  for (const [result, report, expected] of [
    [{ status: 0 }, { passed: true }, null],
    [{ status: 0 }, undefined, /did not complete/],
    [{ status: 0 }, { passed: false }, /did not complete/],
    [{ status: 0, error: Error('ETIMEDOUT') }, { passed: true }, /ETIMEDOUT/],
  ]) {
    let cleaned = false;
    const context = {
      __dirname: path.resolve('tests/electron'),
      process: { argv: ['node', 'run.cjs', 'cobalt-smoke'], env: {} },
      require(name) {
        if (name === 'node:fs')
          return {
            mkdtempSync: () =>
              path.join(
                require('node:os').tmpdir(),
                'tubevra-electron-test-fixture',
              ),
            existsSync: () => report !== undefined,
            readFileSync: () => JSON.stringify(report),
            rmSync(_file, options) {
              if (options.recursive) cleaned = true;
            },
          };
        if (name === 'node:child_process') return { spawnSync: () => result };
        if (name === 'electron') return 'electron';
        return require(name);
      },
    };
    const run = () => vm.runInNewContext(runner, context);
    if (expected) assert.throws(run, expected);
    else {
      run();
      assert.equal(context.process.exitCode, 0);
    }
    assert.equal(cleaned, true);
  }
});
