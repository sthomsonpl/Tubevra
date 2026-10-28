// Exercise the production dock controller with real native views and window
// focus. Only cursor coordinates are simulated; this is not OS hit testing.
const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const profile = process.env.TUBEVRA_TEST_PROFILE;
if (!profile) throw Error('Use the isolated Electron test runner.');
app.setPath('userData', profile);
// Match the source loader used by the Core tests, without a stale app bundle.
require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
};
const {
  createToolbarAutoHide,
} = require('../../src/main/toolbar-auto-hide.ts');
const {
  connectOverlayAnimation,
} = require('../../src/main/overlay-animation.ts');
const { TOOLBAR_STYLE } = require('../../src/main/toolbar-style.ts');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, description) {
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(40);
  }
  throw Error(`Timed out: ${description}`);
}

app
  .whenReady()
  .then(async () => {
    let cursor = { x: -100000, y: -100000 };
    const originalCursor = screen.getCursorScreenPoint;
    screen.getCursorScreenPoint = () => cursor;
    const options = {
      width: 720,
      height: 560,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    };
    const win = new BrowserWindow(options);
    const other = new BrowserWindow({ ...options, width: 200, height: 150 });
    // Keep the fixture painted even when the editor covers the test windows.
    // These flags belong only to the test, as in the existing UI/glass probes.
    win.setAlwaysOnTop(true);
    other.setAlwaysOnTop(true);
    const toolbar = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        backgroundThrottling: false,
      },
    });
    toolbar.setBackgroundColor(TOOLBAR_STYLE.backgroundColor);
    toolbar.setBorderRadius(TOOLBAR_STYLE.borderRadius);
    toolbar.setBackgroundBlur(TOOLBAR_STYLE.backgroundBlur);
    win.contentView.addChildView(toolbar);
    const errors = [];
    let restores = 0;
    let refresh = () => {};
    const policy = createToolbarAutoHide(
      win,
      toolbar,
      () => {
        restores++;
        win.webContents.focus();
      },
      () => refresh(),
    );
    policy.layout();
    const animation = connectOverlayAnimation(
      win,
      [
        {
          view: toolbar,
          captureFrame: () => toolbar.webContents.capturePage(),
          initiallyVisible: true,
          requireFrameBeforeMotion: true,
          onReady: policy.onReady,
          beforeHide: policy.beforeHide,
        },
      ],
      (info) => [
        {
          visible:
            !info.blocked &&
            policy.request(
              info.now,
              info.pointer,
              info.shown[0],
              info.requested[0],
              false,
              info.failed,
            ),
          allowed: true,
          version: policy.version(),
        },
      ],
      (message) => errors.push(message),
    );
    refresh = animation.refresh;
    const dock = {
      layout() {
        policy.layout();
        animation.layout();
      },
      setState(state) {
        policy.setPinned(state.pinned);
        animation.setSuppressed(state.suppressed);
      },
      dispose() {
        animation.dispose();
        policy.dispose();
      },
    };
    dock.setState({ pinned: true, suppressed: false });
    win.contentView.on('bounds-changed', dock.layout);
    const group = win.contentView.children.find(
      (view) => view.constructor.name === 'View',
    );
    const shown = () => toolbar.getVisible() && !group.getVisible();
    const hidden = () => !toolbar.getVisible() && !group.getVisible();
    const move = (inside) => {
      const content = win.getContentBounds();
      const area = win.contentView.getBounds();
      cursor = inside
        ? { x: content.x + area.width / 2, y: content.y + area.height - 2 }
        : { x: -100000, y: -100000 };
    };
    const checks = [];
    try {
      await win.loadURL(
        'data:text/html,<input aria-label="Search"><p>Local dock fixture</p>',
      );
      await other.loadURL('data:text/html,<p>Other window</p>');
      await toolbar.webContents.loadURL(
        'data:text/html,<button>Settings</button>',
      );
      win.focus();
      await waitFor(() => win.isFocused(), 'main window focus');
      dock.layout();
      await delay(500);
      dock.setState({ pinned: false, suppressed: false });
      await waitFor(hidden, 'dock hides after idle');
      move(true);
      await waitFor(shown, 'active window hover');

      move(false);
      other.focus();
      await waitFor(
        () => other.isFocused() && !win.isFocused(),
        'other window focus',
      );
      await waitFor(hidden, 'dock hides while using another window');
      const restoresBefore = restores;
      move(true);
      await waitFor(
        shown,
        'cursor return reveals dock without activating window',
      );
      assert.equal(other.isFocused(), true);
      assert.equal(win.isFocused(), false);
      assert.equal(restores, restoresBefore);
      move(false);
      await waitFor(hidden, 'inactive dock hides again');
      assert.equal(other.isFocused(), true);
      checks.push(
        'inactive window reveals and hides dock without clicks or focus stealing',
      );

      win.focus();
      move(true);
      await waitFor(shown, 'dock available for keyboard navigation');
      toolbar.webContents.focus();
      await waitFor(() => toolbar.webContents.isFocused(), 'toolbar focus');
      toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      toolbar.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
      move(false);
      await delay(2000);
      assert.ok(shown(), 'keyboard navigation keeps the dock visible');
      other.focus();
      await waitFor(() => other.isFocused(), 'leave keyboard navigation');
      const restoresAfterBlur = restores;
      await waitFor(hidden, 'keyboard hold clears when toolbar loses focus');
      assert.equal(other.isFocused(), true);
      assert.equal(restores, restoresAfterBlur);

      win.focus();
      move(true);
      await waitFor(shown, 'dock available for mouse use');
      toolbar.webContents.focus();
      await waitFor(
        () => toolbar.webContents.isFocused(),
        'mouse toolbar focus',
      );
      const restoresBeforeHide = restores;
      move(false);
      await waitFor(hidden, 'mouse use restores content focus on hide');
      assert.equal(restores, restoresBeforeHide + 1);
      assert.equal(win.webContents.isFocused(), true);
      checks.push(
        'keyboard visibility and active-window focus restoration are preserved',
      );

      // A covering window must retain focus. Geometric cursor polling may reveal
      // the dock underneath it, but must never raise or activate Tubevra.
      other.setBounds(win.getBounds());
      other.focus();
      move(true);
      await waitFor(shown, 'covered dock remains in its own window');
      assert.equal(other.isFocused(), true);
      assert.equal(win.isFocused(), false);
      move(false);
      await waitFor(hidden, 'covered dock hides without activating window');
      assert.equal(other.isFocused(), true);
      checks.push('covering window retains focus during reveal');

      win.minimize();
      await waitFor(
        () => win.isMinimized() && hidden(),
        'minimized dock stays hidden',
      );
      await delay(350);
      assert.ok(hidden());
      win.restore();
      win.focus();
      await waitFor(
        () => !win.isMinimized() && win.isFocused(),
        'window restored',
      );
      move(true);
      await waitFor(shown, 'dock works after restoration');
      checks.push('minimization hides dock and restoration preserves hover');

      dock.setState({ pinned: false, suppressed: true });
      await waitFor(hidden, 'playback fullscreen suppresses hover');
      await delay(350);
      assert.ok(hidden());
      dock.setState({ pinned: false, suppressed: false });
      await waitFor(shown, 'dock returns after playback fullscreen');
      win.setFullScreen(true);
      await waitFor(() => win.isFullScreen(), 'native fullscreen');
      dock.layout();
      move(false);
      await waitFor(hidden, 'native fullscreen idle');
      move(true);
      await waitFor(shown, 'native fullscreen hover');
      win.setFullScreen(false);
      await waitFor(() => !win.isFullScreen(), 'leave native fullscreen');
      dock.layout();
      checks.push(
        'playback fullscreen suppression and native fullscreen hover',
      );

      move(false);
      dock.setState({ pinned: true, suppressed: false });
      win.focus();
      win.webContents.focus();
      await win.webContents.executeJavaScript(
        'document.querySelector("input").focus()',
      );
      await delay(2000);
      assert.ok(shown());
      assert.equal(
        await win.webContents.executeJavaScript(
          'document.activeElement.tagName',
        ),
        'INPUT',
      );
      dock.setState({ pinned: false, suppressed: false });
      await waitFor(hidden, 'dock unpins after settings');
      checks.push('settings pinning preserves text input focus');
      assert.deepEqual(errors, []);
      const output = path.resolve('out/verification/dock');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify({ checks, errors }, null, 2),
      );
      console.log(JSON.stringify({ checks, errors }, null, 2));
    } catch (error) {
      console.error({
        windowFocused: win.isFocused(),
        windowVisible: win.isVisible(),
        toolbarVisible: toolbar.getVisible(),
        animationVisible: group.getVisible(),
        pictureBounds: group.children[0].getBounds(),
        toolbarBounds: toolbar.getBounds(),
        contentBounds: win.contentView.getBounds(),
        errors,
      });
      throw error;
    } finally {
      dock.dispose();
      screen.getCursorScreenPoint = originalCursor;
      toolbar.webContents.close();
      win.destroy();
      other.destroy();
    }
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
