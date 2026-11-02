const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) => dependencies[name],
      setTimeout,
      clearTimeout,
      URL,
      ...globals,
    },
  );
  return exports;
}
const shared = load('src/shared/media-capabilities.ts');
const rows = (names) => [
  { description: 'Decoding', value: '' },
  ...names.map((name) => ({
    description: `Decode ${name}`,
    value: '64x64 to 8192x8192 pixels',
  })),
  { description: 'Encoding', value: '' },
  {
    description: 'Encode av1 profile main',
    value: '64x64 to 8192x8192 pixels',
  },
];
function fixture({
  disabled = false,
  hang = false,
  data = rows(['vp9 profile0', 'h264 high']),
} = {}) {
  let created = 0,
    destroyed = 0;
  class Window {
    constructor() {
      created++;
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        executeJavaScript: async () => ({ status: 'enabled', rows: data }),
      };
    }
    loadURL() {
      return hang ? new Promise(() => {}) : Promise.resolve();
    }
    isDestroyed() {
      return false;
    }
    destroy() {
      destroyed++;
    }
  }
  const main = load('src/main/media-capabilities.ts', {
    '../shared/media-capabilities': shared,
    electron: {
      BrowserWindow: Window,
      app: {
        whenReady: async () => {},
        isHardwareAccelerationEnabled: () => !disabled,
        getGPUInfo: async () => ({}),
      },
    },
  });
  return { ...main, counts: () => [created, destroyed] };
}
test('decoder profiles exclude encoders and preserve per-profile absence', () => {
  const profiles = fixture().parseHardwareProfiles(
    rows(['vp9 profile0', 'vp9 profile2', 'h264 high', 'hevc main']),
  );
  assert.deepEqual(
    [...profiles],
    ['vp9 profile0', 'vp9 profile2', 'h264 high'],
  );
  const snapshot = { status: 'ready', profiles };
  assert.equal(
    shared.hardwareProfileSupport(snapshot, 'av1 profile main'),
    false,
  );
  assert.equal(shared.hardwareProfileSupport(snapshot, 'vp9 profile1'), false);
  assert.equal(shared.hardwareProfileSupport(snapshot, 'vp9 profile2'), true);
  assert.ok(Object.isFrozen(profiles));
});
test('empty, truncated and unknown target profile schemas cannot imply absence', () => {
  for (const data of [
    null,
    [],
    rows([]),
    rows(['vp9 unknown']),
    [{ description: 'Decode vp9 profile0', value: 'x' }],
    rows(['vp9 profile0']).slice(0, 2),
  ])
    assert.throws(() => fixture().parseHardwareProfiles(data));
});

test('AV1 and 10-bit profiles are distinct; encrypted-only entries do not prove clear decoding', () => {
  const data = rows([
    'av1 profile main',
    'av1 profile high',
    'h264 high 10',
    'vp9 profile2',
  ]);
  data[1].value += ' (encrypted)';
  assert.deepEqual(
    [...fixture().parseHardwareProfiles(data)],
    ['av1 profile high', 'h264 high 10', 'vp9 profile2'],
  );
  data[2].value = 'unexpected capabilities';
  assert.throws(() => fixture().parseHardwareProfiles(data));
});
test('snapshot validation and disabled/error states never imply unsupported', () => {
  for (const snapshot of [
    { status: 'disabled', profiles: [] },
    { status: 'error', error: 'Unavailable' },
  ]) {
    assert.equal(shared.isHardwareCodecSnapshot(snapshot), true);
    assert.equal(
      shared.hardwareProfileSupport(snapshot, 'av1 profile main'),
      undefined,
    );
  }
  for (const snapshot of [
    { status: 'ready', profiles: ['vp9 profile0', 'vp9 profile0'] },
    { status: 'ready', profiles: ['unknown'] },
    { status: 'error', error: '' },
    { status: 'disabled', profiles: ['vp9 profile0'] },
  ])
    assert.equal(shared.isHardwareCodecSnapshot(snapshot), false);
});
test('detection coalesces, caches and cleans up; invalidation rechecks', async () => {
  const f = fixture(),
    detector = f.createHardwareCodecDetector();
  const a = detector.detect(),
    b = detector.detect();
  assert.equal(a, b);
  const result = await a;
  assert.equal(result.status, 'ready');
  assert.ok(shared.isHardwareCodecSnapshot(result));
  assert.equal(await detector.detect(), result);
  assert.deepEqual(f.counts(), [1, 1]);
  detector.invalidate();
  await detector.detect();
  assert.deepEqual(f.counts(), [2, 2]);
});
test('disabled acceleration skips the diagnostic view', async () => {
  const f = fixture({ disabled: true });
  assert.equal(
    (await f.createHardwareCodecDetector().detect()).status,
    'disabled',
  );
  assert.deepEqual(f.counts(), [0, 0]);
});
test('timeouts destroy the view, do not cache errors and reject invalid timeout options', async () => {
  const f = fixture({ hang: true }),
    detector = f.createHardwareCodecDetector();
  assert.equal((await detector.detect(20)).status, 'error');
  assert.deepEqual(f.counts(), [1, 1]);
  await detector.detect(20);
  assert.deepEqual(f.counts(), [2, 2]);
  await assert.rejects(detector.detect(0));
});

test('disposing an in-flight detector cancels the probe and prevents future windows', async () => {
  const f = fixture({ hang: true }),
    detector = f.createHardwareCodecDetector();
  const pending = detector.detect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  detector.dispose();
  assert.equal((await pending).status, 'error');
  assert.deepEqual(f.counts(), [1, 1]);
  assert.equal((await detector.detect()).status, 'error');
  assert.deepEqual(f.counts(), [1, 1]);
});

test('bootstrap rejects other views, frames, URLs and arguments, owns its data and removes listeners', () => {
  const { EventEmitter } = require('node:events');
  const ipc = new EventEmitter(),
    warnings = [];
  const contents = {
    isDestroyed: () => false,
    mainFrame: { url: 'https://www.youtube.com/tv' },
  };
  const tvDisplay = load('src/shared/tv-display.ts');
  const { connectHardwareCodecs } = load(
    'src/main/media-capabilities-bridge.ts',
    {
      '../shared/media-capabilities': shared,
      '../shared/tv-display': tvDisplay,
    },
  );
  const bridge = connectHardwareCodecs(ipc, contents, (message) =>
    warnings.push(message),
  );
  const ask = (
    event = { sender: contents, senderFrame: contents.mainFrame },
    ...args
  ) => {
    ipc.emit(shared.HARDWARE_CODECS_IPC.bootstrap, event, ...args);
    return event.returnValue;
  };
  assert.equal(ask().ok, false);
  const data = { status: 'ready', profiles: ['vp9 profile0'] };
  bridge.update(data);
  data.profiles.push('av1 profile main');
  assert.deepEqual([...ask().value.profiles], ['vp9 profile0']);
  assert.ok(Object.isFrozen(ask().value.profiles));
  for (const event of [
    { sender: {}, senderFrame: contents.mainFrame },
    { sender: contents, senderFrame: { url: 'https://www.youtube.com/tv' } },
    { sender: contents, senderFrame: null },
  ])
    assert.equal(ask(event).ok, false);
  assert.equal(ask(undefined, 'unexpected').ok, false);
  contents.mainFrame.url = 'https://www.youtube.com/';
  assert.equal(ask().ok, false);
  contents.mainFrame.url = 'https://www.youtube.com/tv';
  const event = { sender: contents, senderFrame: contents.mainFrame };
  ipc.emit(shared.HARDWARE_CODECS_IPC.failure, event, 'test');
  ipc.emit(shared.HARDWARE_CODECS_IPC.failure, event, 'x'.repeat(1001));
  assert.equal(warnings.length, 1);
  assert.throws(() => bridge.update({ status: 'ready', profiles: ['bad'] }));
  bridge.update(undefined);
  assert.equal(ask().ok, false);
  bridge.dispose();
  assert.equal(ipc.listenerCount(shared.HARDWARE_CODECS_IPC.bootstrap), 0);
  assert.equal(ipc.listenerCount(shared.HARDWARE_CODECS_IPC.failure), 0);
});

test('preload bootstraps once only in Cobalt main TV frames and preserves errors without throwing', () => {
  const tvDisplay = load('src/shared/tv-display.ts');
  for (const [main, url, ua, allowed] of [
    [true, 'https://www.youtube.com/tv', 'Cobalt/26', true],
    [false, 'https://www.youtube.com/tv', 'Cobalt/26', false],
    [true, 'https://www.youtube.com/', 'Cobalt/26', false],
    [true, 'https://www.youtube.com/tv', 'Chrome/156', false],
  ]) {
    let requests = 0;
    const preload = load(
      'src/preload/media-capabilities.ts',
      {
        '../shared/media-capabilities': shared,
        '../shared/tv-display': tvDisplay,
        electron: {
          ipcRenderer: {
            sendSync() {
              requests++;
              return { ok: true, value: { status: 'disabled', profiles: [] } };
            },
            send() {},
          },
        },
      },
      {
        process: { isMainFrame: main },
        location: { href: url },
        navigator: { userAgent: ua },
      },
    );
    preload.bootstrapHardwareCodecs();
    preload.bootstrapHardwareCodecs();
    assert.equal(requests, allowed ? 1 : 0);
  }
  const warnings = [];
  const preload = load(
    'src/preload/media-capabilities.ts',
    {
      '../shared/media-capabilities': shared,
      '../shared/tv-display': tvDisplay,
      electron: {
        ipcRenderer: {
          sendSync: () => ({
            ok: true,
            value: { status: 'ready', profiles: ['bad'] },
          }),
          send: (...args) => warnings.push(args),
        },
      },
    },
    {
      process: { isMainFrame: true },
      location: { href: 'https://www.youtube.com/tv' },
      navigator: { userAgent: 'Cobalt/26' },
    },
  );
  assert.equal(preload.bootstrapHardwareCodecs().status, 'error');
  assert.equal(warnings.length, 1);
});
