const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const { selectTVDisplay } = require('../src/main/tv-display.ts');
const { connectTVDisplay } = require('../src/main/tv-display-bridge.ts');
const { TV_DISPLAY_IPC } = require('../src/shared/tv-display.ts');
const { overrideTVScreen } = require('../src/preload/tv-screen.ts');
const {
  overrideTVPlayerDisplay,
} = require('../src/preload/tv-player-display.ts');
const output = { width: 3840, height: 2160, scaleFactor: 2 };
const monitor = (id, width, height, scaleFactor = 1) => ({
  id,
  bounds: { width, height },
  scaleFactor,
});
// Exercise the same self-contained function serialization as contextBridge.
const execute = (entry, window) =>
  vm.runInNewContext(`(${entry.toString()})(output)`, { window, output });

test('display conversion preserves DPI, rounding, orientation and aspect ratio', () => {
  for (const [width, height, scaleFactor, expectedWidth, expectedHeight] of [
    [1920, 1080, 1, 1920, 1080],
    [2560, 1440, 1, 2560, 1440],
    [3840, 2160, 1, 3840, 2160],
    [2560, 1440, 1.5, 3840, 2160],
    [1920, 1080, 2, 3840, 2160],
    [1080, 1920, 1, 1080, 1920],
    [3440, 1440, 1, 3440, 1440],
    [1537, 865, 1.25, 1921, 1081],
  ]) {
    const selected = selectTVDisplay(
      [monitor(1, width, height, scaleFactor)],
      1,
    );
    assert.equal(selected.width, expectedWidth);
    assert.equal(selected.height, expectedHeight);
    assert.ok(Object.isFrozen(selected));
  }
});

test('largest output wins, ties are deterministic and invalid displays fail', () => {
  const displays = [
    monitor(1, 1920, 1080),
    monitor(9, 1920, 1080, 2),
    monitor(4, 3840, 2160),
  ];
  assert.equal(selectTVDisplay(displays, 9).scaleFactor, 2);
  assert.equal(selectTVDisplay(displays, 1).scaleFactor, 1);
  assert.deepEqual(
    selectTVDisplay(displays, 1),
    selectTVDisplay([...displays].reverse(), 1),
  );
  assert.throws(() => selectTVDisplay([], 1), /detection failed/);
  for (const display of [
    monitor(1, 0, 1080),
    monitor(1, NaN, 1080),
    monitor(1, 1920, 1080, 0),
  ])
    assert.throws(() => selectTVDisplay([display], 1), /invalid display/);
});

test('display IPC rejects other views, subframes and non-TV URLs and retains a snapshot', () => {
  const ipc = new EventEmitter();
  const contents = {
    mainFrame: { url: 'https://www.youtube.com/tv' },
    isDestroyed: () => false,
  };
  const parameters = { ...output };
  const bridge = connectTVDisplay(ipc, contents, parameters, () => {});
  const request = (overrides = {}) => {
    const event = {
      sender: contents,
      senderFrame: contents.mainFrame,
      ...overrides,
    };
    ipc.emit(TV_DISPLAY_IPC.bootstrap, event);
    return event.returnValue;
  };
  parameters.width = 100;
  assert.deepEqual(request(), { ok: true, value: output });
  assert.equal(request({ sender: {} }).ok, false);
  assert.equal(
    request({ senderFrame: { url: contents.mainFrame.url } }).ok,
    false,
  );
  for (const url of [
    'https://www.youtube.com/watch',
    'https://example.com/tv',
    'http://www.youtube.com/tv',
  ]) {
    contents.mainFrame.url = url;
    assert.equal(request().ok, false);
  }
  bridge.dispose();
  assert.equal(ipc.listenerCount(TV_DISPLAY_IPC.bootstrap), 0);
  assert.equal(ipc.listenerCount(TV_DISPLAY_IPC.failure), 0);
});

test('screen correction retains native layout and DPR', () => {
  const window = {
    screen: { availWidth: 1920, availHeight: 1032 },
    devicePixelRatio: 1.5,
    innerWidth: 800,
  };
  const originalScreen = window.screen;
  execute(overrideTVScreen, window);
  assert.equal(window.screen, originalScreen);
  assert.equal(window.screen.width, 2560);
  window.devicePixelRatio = 2;
  assert.equal(window.screen.width, 1920);
  assert.equal(window.screen.height, 1080);
  assert.equal(window.screen.availHeight, 1032);
  assert.equal(window.innerWidth, 800);
});

test('player exports are corrected synchronously without mutating inputs or swallowing original errors', () => {
  const window = {
    devicePixelRatio: 1.5,
    document: { getElementById: () => null },
  };
  const control = execute(overrideTVPlayerDisplay, window);
  let received;
  window.yt = { player: { instances: {}, Application: {} } };
  const instances = window.yt.player.instances;
  instances.createFromWebPlayerContextConfig = function (...args) {
    received = args;
    assert.equal(this, instances);
    return 'created';
  };
  const context = Object.freeze({
    videoContainerOverride: '800x600',
    kept: {},
  });
  assert.equal(
    instances.createFromWebPlayerContextConfig(null, context),
    'created',
  );
  assert.equal(received.length, 2);
  assert.equal(received[1].videoContainerOverride, '2560x1440');
  assert.equal(received[1].kept, context.kept);
  assert.equal(context.videoContainerOverride, '800x600');
  window.devicePixelRatio = 2;
  const application = window.yt.player.Application;
  application.create = (_target, config) =>
    config.args.video_container_override;
  const config = Object.freeze({
    args: Object.freeze({ video_container_override: '800x600' }),
  });
  assert.equal(application.create(null, config), '1920x1080');
  const originalError = Error('native failure');
  application.create = () => {
    throw originalError;
  };
  assert.throws(
    () => application.create(null, config),
    (error) => error === originalError,
  );
  assert.equal(control.takeError(), null);
});

test('unsupported player configuration is rejected and reported', () => {
  const window = {
    devicePixelRatio: 1,
    document: { getElementById: () => null },
  };
  const control = execute(overrideTVPlayerDisplay, window);
  let invoked = false;
  window.yt = {
    player: {
      instances: {
        createFromWebPlayerContextConfig() {
          invoked = true;
        },
      },
    },
  };
  assert.throws(
    () => window.yt.player.instances.createFromWebPlayerContextConfig(null, {}),
    /Unsupported player display/,
  );
  assert.equal(invoked, false);
  assert.match(control.takeError(), /compatibility failed/);
});
