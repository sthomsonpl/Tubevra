const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');

class View extends EventEmitter {
  constructor() {
    super();
    this.children = [];
    this.visible = false;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }
  setBackgroundColor() {}
  setBackgroundBlur() {}
  setBorderRadius() {}
  setImage(image) {
    this.image = image;
  }
  setBounds(bounds) {
    this.bounds = { ...bounds };
  }
  getBounds() {
    return { ...this.bounds };
  }
  setVisible(value) {
    this.visible = value;
  }
  getVisible() {
    return this.visible;
  }
  addChildView(view) {
    this.children.push(view);
  }
}
const frame = (version) => ({ version, isEmpty: () => false });
class Surface extends View {
  constructor() {
    super();
    this.webContents = new EventEmitter();
    this.webContents.capturePage = async () => frame(0);
    this.webContents.isFocused = () => false;
  }
}
let cursor;
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'electron')
    return {
      View,
      ImageView: View,
      nativeImage: { createEmpty: () => ({ neutral: true }) },
      screen: { getCursorScreenPoint: () => cursor },
    };
  return originalLoad.call(this, id, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    file,
  );
const { createToolbarAutoHide } = require('../src/main/toolbar-auto-hide.ts');
const { connectOverlayAnimation } = require('../src/main/overlay-animation.ts');
const { createRatingsVisibility } = require('../src/main/ratings-panel.ts');
Module._load = originalLoad;
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
async function fixture(t) {
  let now = 0,
    update,
    held = false;
  const pending = [],
    errors = [];
  cursor = { x: -10000, y: -10000 };
  t.mock.method(performance, 'now', () => now);
  t.mock.method(global, 'setInterval', (fn) => {
    update = fn;
    return 0;
  });
  const window = new EventEmitter();
  window.contentView = new View();
  window.contentView.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  window.isVisible = () => true;
  window.isMinimized = () => false;
  window.isFocused = () => true;
  window.getContentBounds = () => ({ x: 0, y: 0, width: 1280, height: 800 });
  const dock = new Surface(),
    panel = new Surface();
  let refresh = () => {};
  const dockPolicy = createToolbarAutoHide(
    window,
    dock,
    () => {},
    () => refresh(),
  );
  const ratingsPolicy = createRatingsVisibility();
  const layout = () => {
    dockPolicy.layout();
    const { width, height } = window.contentView.getBounds();
    const anchor = dock.getBounds(),
      x = width - 240;
    panel.setBounds({
      x,
      y: x >= anchor.x + anchor.width + 12 ? height - 88 : anchor.y - 80,
      width: 220,
      height: 68,
    });
  };
  layout();
  const animation = connectOverlayAnimation(
    window,
    [
      {
        view: dock,
        captureFrame: () => dock.webContents.capturePage(),
        initiallyVisible: true,
        requireFrameBeforeMotion: true,
        onReady: dockPolicy.onReady,
        beforeHide: dockPolicy.beforeHide,
      },
      {
        view: panel,
        clearOnVersionChange: true,
        captureFrame: (version) =>
          held
            ? new Promise((resolve) =>
                pending.push(() => resolve(frame(version))),
              )
            : Promise.resolve(frame(version)),
      },
    ],
    (info) => {
      const visible =
        !info.blocked &&
        dockPolicy.request(
          info.now,
          info.pointer,
          info.shown[0],
          info.requested[0],
          info.hovered[1],
          info.failed,
        );
      return [
        { visible, allowed: true, version: dockPolicy.version() },
        ratingsPolicy.request(info.now, visible, info.hovered[1], info.blocked),
      ];
    },
    (error) => errors.push(error),
  );
  refresh = animation.refresh;
  const control = {
    layout() {
      layout();
      animation.layout();
    },
    dispose() {
      animation.dispose();
      dockPolicy.dispose();
    },
    setRatingsState(snapshot, allowed) {
      ratingsPolicy.update(snapshot, allowed, now);
      animation.refresh();
    },
  };
  t.after(() => control.dispose());
  const group = window.contentView.children[0],
    picture = group.children[1];
  const step = async (ms) => {
    now += ms;
    update();
    await flush();
  };
  const state = (version, id = 'AAAAAAAAAAA', kind = 'ready') =>
    control.setRatingsState(
      {
        version,
        generation: version,
        kind,
        videoId: id,
        likes: 1,
        dislikes: 2,
      },
      true,
    );
  const visible = (surface) =>
    surface.visible ||
    (group.visible && group.children[surface === dock ? 0 : 1].visible);
  dock.webContents.emit('did-finish-load');
  panel.webContents.emit('did-finish-load');
  await step(1700);
  await step(250);
  state(1);
  await step(1);
  await step(250);
  await step(4100);
  await step(250);
  return {
    dock,
    panel,
    group,
    picture,
    control,
    window,
    step,
    state,
    visible,
    errors,
    hold: () => {
      held = true;
    },
    release: async () => {
      held = false;
      for (const resolve of pending.splice(0)) resolve();
      await flush();
    },
    reveal: () => {
      cursor = { x: 640, y: 799 };
    },
    leave: () => {
      cursor = { x: -10000, y: -10000 };
    },
  };
}
for (const order of ['autoplay-first', 'hover-first'])
  test('simultaneous autoplay and dock: ' + order, async (t) => {
    const e = await fixture(t);
    if (order === 'autoplay-first') e.state(2, 'BBBBBBBBBBB', 'loading');
    e.reveal();
    await e.step(1);
    if (order === 'hover-first') e.state(2, 'BBBBBBBBBBB', 'loading');
    await flush();
    await e.step(250);
    assert.ok(e.dock.visible && e.panel.visible);
    assert.deepEqual(e.errors, []);
  });
for (const [id, kind] of [
  ['BBBBBBBBBBB', 'loading'],
  ['AAAAAAAAAAA', 'ready'],
])
  test(
    'delayed frame during motion keeps glass and clears old counts: ' + kind,
    async (t) => {
      const e = await fixture(t);
      e.reveal();
      await e.step(1);
      await e.step(70);
      const y = e.picture.getBounds().y;
      e.hold();
      e.state(2, id, kind);
      await flush();
      assert.ok(e.visible(e.panel));
      assert.ok(
        e.picture.image.neutral,
        'old counters are removed immediately',
      );
      await e.step(40);
      assert.ok(e.visible(e.panel) && e.visible(e.dock));
      assert.ok(
        e.picture.getBounds().y < y,
        'movement continues while frame is pending',
      );
      await e.step(250);
      assert.ok(e.visible(e.panel));
      assert.equal(
        e.panel.visible,
        false,
        'neutral raster remains until renderer confirms the new version',
      );
      await e.release();
      assert.ok(e.panel.visible && e.dock.visible);
      assert.equal(e.picture.image.version, 2);
      assert.deepEqual(e.errors, []);
    },
  );
test('resize during motion retains both surfaces and the same progress', async (t) => {
  const e = await fixture(t);
  e.reveal();
  await e.step(1);
  await e.step(70);
  e.hold();
  e.window.contentView.setBounds({ x: 0, y: 0, width: 624, height: 475 });
  e.control.layout();
  assert.ok(e.visible(e.panel) && e.visible(e.dock));
  const offsets = e.group.children.map(
    (p, i) =>
      p.getBounds().y -
      ([e.dock, e.panel][i].getBounds().y - e.group.getBounds().y),
  );
  assert.equal(offsets[0], offsets[1]);
  await e.step(40);
  assert.ok(e.visible(e.panel) && e.visible(e.dock));
  await e.release();
  await e.step(250);
  assert.ok(e.panel.visible && e.dock.visible);
});
test('late frame cannot restore older counts after another autoplay', async (t) => {
  const e = await fixture(t);
  e.reveal();
  await e.step(1);
  await e.step(70);
  e.hold();
  e.state(2, 'BBBBBBBBBBB');
  await flush();
  e.state(3, 'CCCCCCCCCCC');
  assert.ok(e.picture.image.neutral);
  await e.release();
  await e.step(250);
  assert.equal(e.picture.image.version, 3);
  assert.ok(e.panel.visible);
});
test('popup expiry while dock is held and reveal during popup exit retain continuity', async (t) => {
  const e = await fixture(t);
  e.state(2, 'BBBBBBBBBBB');
  await e.step(1);
  await e.step(250);
  e.reveal();
  await e.step(1);
  await e.step(250);
  await e.step(4200);
  assert.ok(e.panel.visible && e.dock.visible);
  e.leave();
  await e.step(1);
  await e.step(1700);
  await e.step(70);
  const y = e.picture.getBounds().y;
  e.reveal();
  await e.step(1);
  await e.step(40);
  assert.ok(e.visible(e.panel));
  assert.ok(e.picture.getBounds().y <= y);
  await e.step(250);
  assert.ok(e.panel.visible && e.dock.visible);
});

test('RYD popup policy works without a dock, native view or its own timer', (t) => {
  t.mock.method(global, 'setInterval', () => {
    throw Error('Unexpected independent clock');
  });
  const policy = createRatingsVisibility();
  policy.update(
    { version: 1, generation: 1, kind: 'loading', videoId: 'AAAAAAAAAAA' },
    true,
    0,
  );
  assert.equal(policy.request(10000, false, false, false).visible, true);
  policy.update(
    {
      version: 2,
      generation: 1,
      kind: 'ready',
      videoId: 'AAAAAAAAAAA',
      likes: 1,
      dislikes: 2,
    },
    true,
    10000,
  );
  assert.equal(policy.request(13999, false, false, false).visible, true);
  assert.equal(policy.request(14000, false, false, false).visible, false);
  assert.equal(policy.request(15000, true, false, false).visible, true);
  assert.equal(policy.request(15000, true, false, true).visible, false);
  policy.update({ version: 3, generation: 2, kind: 'no-video' }, false, 16000);
  assert.equal(policy.request(16000, true, false, false).allowed, false);
});
