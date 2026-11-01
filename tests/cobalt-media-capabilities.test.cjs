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
vm.runInNewContext(source, { exports: exportsObject, require: () => ({}) });
const {
  hasCobaltUserAgent,
  cobaltMediaLimits,
  overrideCobaltMediaCapabilities,
} = exportsObject;
function fixture(display = { width: 1920, height: 1080 }, hdr = false) {
  const calls = [];
  const native = function (type) {
    calls.push(type);
    if (type === 'throw') throw Error('native failure');
    return !String(type).includes('nonexistent');
  };
  const context = {
    MediaSource: { isTypeSupported: native },
    window: { matchMedia: () => ({ matches: hdr }) },
    limits: cobaltMediaLimits(display),
  };
  vm.createContext(context);
  vm.runInContext(
    `(${overrideCobaltMediaCapabilities.toString()})(limits)`,
    context,
  );
  return {
    context,
    calls,
    check: (type) => context.MediaSource.isTypeSupported(type),
  };
}
const vp9 = 'video/webm; codecs="vp9"';
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
