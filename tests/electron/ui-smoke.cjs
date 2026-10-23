// Integration test against the production bundles. YouTube is replaced only
// inside this test process by a local TV fixture; this is not a live-site test.
const {
  app,
  BrowserWindow,
  webContents,
  session,
  desktopCapturer,
  ipcMain,
  screen,
  nativeImage,
  shell: externalShell,
} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve('out/verification/ui');
fs.mkdirSync(output, { recursive: true });
const profile = process.env.TUBEVRA_TEST_PROFILE;
if (!profile)
  throw new Error('Use the Electron test runner to isolate user data.');
app.setPath('userData', profile);
const checks = [];
const errors = [];
const requests = [];
let failNextLoad = false;
// A local silent WAV exercises the real media clock without network or codecs.
const audio = Buffer.alloc(44 + 8000 * 2 * 30);
audio.write('RIFF', 0);
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(audio.length - 44, 40);
const fixture = `<!doctype html><meta charset="utf-8"><title>Local TV fixture</title>
<style>body{margin:0;background:linear-gradient(120deg,#142837,#466360 45%,#392d4c);color:white;font:20px sans-serif;height:100vh}h1{padding:60px 60px 0}input{margin:30px 60px;padding:10px}#player{background:#151515;width:300px;height:180px;margin:0 60px}footer{position:absolute;bottom:0;height:110px;width:100%;background:repeating-linear-gradient(90deg,#497e9d 0 12px,#16334b 12px 24px)}</style>
<h1>Local TV integration fixture</h1><input id="search" aria-label="Search"/><video id="player"></video><footer></footer>
<script>window.backCount=0;window.keys=[];document.addEventListener('keydown',e=>{window.keys.push(e.key);if(e.key==='Escape')window.backCount++});
// Model a player that pauses when Electron reports its page as hidden.
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelector('#player').pause()});</script>`;

app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, filename, error) =>
    errors.push(`${filename}: ${error.message}`),
  );
});
async function waitFor(predicate, description) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${description}`);
}
async function capture(win, name) {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1600, height: 1200 },
  });
  const source = sources.find((entry) => entry.id === win.getMediaSourceId());
  assert.ok(source && !source.thumbnail.isEmpty());
  fs.writeFileSync(path.join(output, `${name}.png`), source.thumbnail.toPNG());
}

app
  .whenReady()
  .then(async () => {
    let cursor = { x: -100000, y: -100000 };
    screen.getCursorScreenPoint = () => cursor;
    await session
      .fromPartition('persist:tubevra-tv')
      .protocol.handle('https', (request) => {
        if (new URL(request.url).pathname === '/tv/test-audio.wav') {
          return new Response(audio, {
            headers: { 'content-type': 'audio/wav' },
          });
        }
        requests.push({
          url: request.url,
          ua: request.headers.get('user-agent'),
        });
        if (failNextLoad) {
          failNextLoad = false;
          return Response.error();
        }
        return new Response(fixture, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });
    // Use the immutable package, since an existing dev watcher may rebuild .vite.
    require(
      path.join(
        process.env.TUBEVRA_TEST_PACKAGE ??
          path.resolve('out/Tubevra-win32-x64'),
        'resources/app.asar/.vite/build/main.cjs',
      ),
    );
    const win = await waitFor(
      () => BrowserWindow.getAllWindows()[0],
      'main window',
    );
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    const shell = win.webContents;
    const toolbar = await waitFor(
      () =>
        webContents
          .getAllWebContents()
          .find((entry) => entry.getURL().endsWith('#toolbar')),
      'toolbar',
    );
    const tv = await waitFor(
      () =>
        webContents
          .getAllWebContents()
          .find((entry) =>
            entry.getURL().startsWith('https://www.youtube.com/tv'),
          ),
      'TV fixture',
    );
    const state = async () =>
      (await shell.executeJavaScript('window.tubevra.getState()')).value;
    const idle = async () =>
      waitFor(
        async () =>
          !(await state()).loading &&
          (await shell.executeJavaScript(
            '!document.querySelector("#editor-fields").disabled',
          )),
        'idle UI',
      );
    const click = (contents, id) =>
      contents.executeJavaScript(
        `document.getElementById(${JSON.stringify(id)}).click()`,
      );
    await idle();
    assert.equal((await state()).error, null);
    assert.deepEqual(
      await tv.executeJavaScript(
        '[typeof window.tubevra,typeof require,typeof process]',
      ),
      ['undefined', 'undefined', 'undefined'],
    );
    assert.equal((await state()).userAgents.presets.length, 7);
    checks.push('isolated production preload and TV view');
    const getExtensions = ipcMain._invokeHandlers.get('tubevra:extensions:get');
    const setExtension = ipcMain._invokeHandlers.get(
      'tubevra:extensions:set-enabled',
    );
    const reloadTV = ipcMain._invokeHandlers.get('tubevra:reload-tv');
    const openProjectGitHub = ipcMain._invokeHandlers.get(
      'tubevra:open-project-github',
    );
    const trusted = { sender: shell, senderFrame: shell.mainFrame };
    for (const handler of [
      getExtensions,
      setExtension,
      reloadTV,
      openProjectGitHub,
    ]) {
      for (const event of [
        { sender: tv, senderFrame: tv.mainFrame },
        { sender: shell, senderFrame: { url: shell.getURL() } },
        { sender: shell, senderFrame: { url: 'https://example.com' } },
      ]) {
        await assert.rejects(async () => handler(event), /Untrusted/);
      }
    }
    assert.equal(getExtensions(trusted, 'extra').ok, false);
    for (const command of [
      null,
      {},
      { id: 'missing', enabled: true },
      { id: 'x', enabled: 'true' },
    ]) {
      assert.equal((await setExtension(trusted, command)).ok, false);
    }
    assert.equal((await reloadTV(trusted, 'extra')).ok, false);
    assert.equal(
      (await openProjectGitHub(trusted, 'https://example.com')).ok,
      false,
    );
    await shell.executeJavaScript(
      `document.querySelector('[data-section="extensions"]').click()`,
    );
    assert.match(
      await shell.executeJavaScript(
        'document.querySelector("#panel-extensions").textContent',
      ),
      /Adblock/,
    );
    assert.deepEqual(
      (
        await shell.executeJavaScript('window.tubevra.getExtensions()')
      ).value.items.map((item) => item.id),
      ['adblock'],
    );
    await shell.executeJavaScript(
      `document.querySelector('[data-section="user-agents"]').click()`,
    );
    checks.push('Adblock registration and local IPC sender/payload validation');
    // Separate test-only engine for the remaining lifecycle scenarios.
    const ts = require('typescript');
    require.extensions['.ts'] = (module, filename) =>
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
    const {
      TubervaExtensions,
    } = require('../../src/extensions/tuberva-extensions.ts');
    let failStart = false;
    const engine = await TubervaExtensions.open(
      path.join(profile, 'extensions-ui-test'),
      [
        {
          id: 'sample',
          name: 'UI sample',
          description: 'Test module',
          modes: ['tv'],
          main: true,
          page: true,
          defaultEnabled: false,
        },
      ],
      { onBeforeRequest() {} },
      {
        sample: () => {
          if (failStart) throw Error('Test start failure');
          return () => {};
        },
      },
    );
    // Continue after the production document revision used by this renderer.
    while (engine.snapshot().revision <= (await state()).extensions.revision)
      engine.resetPage();
    const notify = () =>
      shell.send('tubevra:extensions:state-changed', engine.snapshot());
    ipcMain.removeHandler('tubevra:extensions:set-enabled');
    ipcMain.handle(
      'tubevra:extensions:set-enabled',
      async (_event, command) => {
        await engine.update(command);
        notify();
        return { ok: true, value: engine.snapshot() };
      },
    );
    await shell.executeJavaScript(
      `document.querySelector('[data-section="extensions"]').click()`,
    );
    notify();
    const panelText = () =>
      shell.executeJavaScript(
        'document.querySelector("#panel-extensions").textContent',
      );
    const toggle = () =>
      shell.executeJavaScript(
        'document.querySelector("#panel-extensions input").click()',
      );
    await waitFor(
      async () => (await panelText()).includes('UI sample'),
      'sample UI',
    );
    await toggle();
    await waitFor(
      async () => (await panelText()).includes('Starting'),
      'actual starting state',
    );
    await engine.reportPage({
      layer: 'page',
      document: 'ui-fixture',
      instance: '1',
      reloadReason: null,
      id: 'sample',
      revision: engine.snapshot().revision,
      status: 'active',
      error: null,
    });
    notify();
    await waitFor(
      async () => (await panelText()).includes('Active'),
      'runtime confirmation',
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    await capture(win, 'extensions');
    await toggle();
    await waitFor(
      async () => (await panelText()).includes('Disabled'),
      'disabled sample',
    );
    failStart = true;
    await toggle();
    await waitFor(
      async () => (await panelText()).includes('Test start failure'),
      'visible start error',
    );
    await toggle();
    await waitFor(
      async () => (await panelText()).includes('Disabled'),
      'disable failed sample',
    );
    failStart = false;
    await toggle();
    await waitFor(
      async () => (await panelText()).includes('Starting'),
      'reenabled sample',
    );
    await engine.reportPage({
      id: 'sample',
      revision: engine.snapshot().revision,
      layer: 'page',
      document: 'ui-fixture',
      instance: '2',
      reloadReason: 'Page effects require a new document.',
      status: 'active',
      error: null,
    });
    notify();
    await waitFor(
      async () => (await panelText()).includes('Reload required'),
      'reload notice',
    );
    const beforeReload = requests.length;
    await shell.executeJavaScript(
      'document.querySelector("#panel-extensions button").click()',
    );
    await waitFor(() => requests.length > beforeReload, 'explicit reload');
    await idle();
    await engine.dispose();
    ipcMain.removeHandler('tubevra:extensions:set-enabled');
    ipcMain.handle('tubevra:extensions:set-enabled', setExtension);
    shell.send('tubevra:extensions:state-changed', (await state()).extensions);
    await shell.executeJavaScript(
      `document.querySelector('[data-section="user-agents"]').click()`,
    );
    checks.push(
      'Extensions test engine: toggles, runtime status, failure, disable and explicit reload',
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    const dockView = win.contentView.children.find(
      (view) => view.webContents === toolbar,
    );
    const dockGroup = win.contentView.children.find(
      (view) => view.constructor.name === 'View',
    );
    assert.ok(dockGroup);
    assert.equal(dockGroup.children[0].constructor.name, 'ImageView');
    const moveCursor = (x, y) => {
      const content = win.getContentBounds();
      cursor = { x: content.x + x, y: content.y + y };
    };
    const dockHidden = () => !dockView.getVisible() && !dockGroup.getVisible();
    const dockShown = () => dockView.getVisible() && !dockGroup.getVisible();
    let area = win.contentView.getBounds();
    win.focus();
    moveCursor(5, area.height - 48);
    await waitFor(dockShown, 'full-width bottom strip reveals dock');

    // Record the composed window, not capturePage: the regression involved the
    // native glass and embedded page appearing in different screen positions.
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const source = sources.find((entry) => entry.id === win.getMediaSourceId());
    assert.ok(source);
    shell.setBackgroundThrottling(false);
    shell.session.setPermissionRequestHandler(
      (_contents, permission, callback) =>
        callback(permission === 'display-capture' || permission === 'media'),
    );
    shell.session.setPermissionCheckHandler(
      (_contents, permission) =>
        permission === 'display-capture' || permission === 'media',
    );
    shell.session.setDisplayMediaRequestHandler((_request, callback) =>
      callback({ video: source }),
    );
    await shell.executeJavaScript(
      `(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
      const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 130;
      const context = canvas.getContext('2d');
      window.dockVideo = { stream, capture() {
        context.drawImage(video, (video.videoWidth - 420) / 2, video.videoHeight - 130, 420, 130, 0, 0, 420, 130);
        return canvas.toDataURL('image/png').split(',')[1];
      }};
    })()`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const reference = await shell.executeJavaScript(
      'window.dockVideo.capture()',
    );
    moveCursor(5, 5);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.ok(dockShown(), 'dock remains visible for more than a second');
    await waitFor(dockHidden, 'original dock slides fully out');
    const hidden = await shell.executeJavaScript('window.dockVideo.capture()');
    const reveal = setTimeout(() => moveCursor(5, area.height - 48), 300);
    const frames = await shell.executeJavaScript(`new Promise(resolve => {
      const frames = []; const start = performance.now();
      const timer = setInterval(() => {
        frames.push({ ms: performance.now() - start, png: window.dockVideo.capture() });
        if (performance.now() - start >= 1100) { clearInterval(timer); resolve(frames); }
      }, 16);
    })`);
    clearTimeout(reveal);
    await waitFor(dockShown, 'original buttons take over after animation');
    await shell.executeJavaScript(
      'window.dockVideo.stream.getTracks().forEach(track => track.stop()); delete window.dockVideo;',
    );
    shell.session.setDisplayMediaRequestHandler(null);
    shell.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    shell.session.setPermissionCheckHandler(() => false);
    const decode = (png) =>
      nativeImage.createFromBuffer(Buffer.from(png, 'base64')).toBitmap();
    const backdrop = decode(hidden);
    const baseline = decode(reference);
    const motion = frames.map((frame, index) => {
      const pixels = decode(frame.png);
      let panelTop = 130;
      let iconTop = 130;
      let whites = 0;
      for (let y = 0; y < 130; y++) {
        let changed = 0;
        for (let x = 100; x < 320; x++) {
          const k = (y * 420 + x) * 4;
          if (
            Math.abs(pixels[k] - backdrop[k]) +
              Math.abs(pixels[k + 1] - backdrop[k + 1]) +
              Math.abs(pixels[k + 2] - backdrop[k + 2]) >
            24
          )
            changed++;
          if (pixels[k] > 180 && pixels[k + 1] > 180 && pixels[k + 2] > 180) {
            whites++;
            iconTop = Math.min(iconTop, y);
          }
        }
        if (changed > 80) panelTop = Math.min(panelTop, y);
      }
      fs.writeFileSync(
        path.join(output, `dock-frame-${index}.png`),
        Buffer.from(frame.png, 'base64'),
      );
      if (panelTop < 88) {
        assert.ok(
          whites > 25,
          `icons must be present while the panel is visible at ${frame.ms}ms`,
        );
        assert.ok(
          iconTop - panelTop >= 10 && iconTop - panelTop <= 23,
          'icons and original glass travel together',
        );
      }
      return { ms: frame.ms, panelTop, iconTop, whites };
    });
    const visibleFrames = motion.filter((frame) => frame.panelTop < 110);
    assert.ok(
      visibleFrames.some(
        (frame) => frame.panelTop > visibleFrames.at(-1).panelTop + 10,
      ),
      'recorded intermediate positions',
    );
    for (let i = 1; i < visibleFrames.length; i++)
      assert.ok(
        visibleFrames[i].panelTop <= visibleFrames[i - 1].panelTop + 2,
        'no backwards jump at handoff',
      );
    const finalPixels = decode(frames.at(-1).png);
    let difference = 0;
    for (let i = 0; i < finalPixels.length; i += 4)
      for (let c = 0; c < 3; c++)
        difference += Math.abs(finalPixels[i + c] - baseline[i + c]);
    assert.ok(
      difference / (420 * 130 * 3) < 1,
      'original style is preserved after handoff',
    );
    fs.writeFileSync(
      path.join(output, 'dock-motion.json'),
      JSON.stringify(motion, null, 2),
    );
    checks.push(
      'composed-window pixels: original style, unified glass/icons, intermediate frames, no handoff jump and longer hide delay',
    );
    moveCursor(5, 5);
    await waitFor(dockHidden, 'dock hides before reversal test');
    moveCursor(area.width / 2, area.height - 2);
    await waitFor(() => dockGroup.getVisible(), 'dock slides in');
    await waitFor(dockShown, 'dock becomes interactive');
    moveCursor(5, 5);
    await waitFor(() => dockGroup.getVisible(), 'dock begins sliding out');
    moveCursor(area.width / 2, area.height - 2);
    await waitFor(dockShown, 'hide reverses without losing buttons');
    const initialToolbarBounds = win.contentView.children
      .find((view) => view.webContents === toolbar)
      .getBounds();
    assert.equal(
      initialToolbarBounds.y + initialToolbarBounds.height,
      win.contentView.getBounds().height - 20,
    );
    await capture(win, 'toolbar');

    await click(toolbar, 'settings');
    await waitFor(async () => (await state()).settingsOpen, 'settings open');
    await shell.executeJavaScript(
      `document.querySelector('[data-section="about"]').click()`,
    );
    assert.deepEqual(
      await shell.executeJavaScript(`[
        document.querySelector('#panel-about').hidden,
        document.querySelector('#panel-user-agents').hidden,
        document.querySelector('#app-version').textContent,
        document.querySelector('#project-github').href
      ]`),
      [false, true, app.getVersion(), 'https://github.com/sthomsonpl/Tubevra'],
    );
    const openExternal = externalShell.openExternal;
    const opened = [];
    try {
      externalShell.openExternal = async (url) => {
        opened.push(url);
      };
      await click(shell, 'project-github');
      await waitFor(() => opened.length === 1, 'project link opened');
      assert.deepEqual(opened, ['https://github.com/sthomsonpl/Tubevra']);
      externalShell.openExternal = async () => {
        throw new Error('Browser unavailable');
      };
      await click(shell, 'project-github');
      await waitFor(
        () =>
          shell.executeJavaScript(
            `document.querySelector('#about-feedback').textContent === 'Browser unavailable'`,
          ),
        'visible browser failure',
      );
      externalShell.openExternal = async () => {};
      await click(shell, 'project-github');
    } finally {
      externalShell.openExternal = openExternal;
    }
    await capture(win, 'about');
    win.setSize(640, 680);
    await capture(win, 'about-compact');
    assert.equal(
      await shell.executeJavaScript(
        'document.documentElement.scrollWidth <= innerWidth',
      ),
      true,
    );
    win.setSize(1280, 800);
    await shell.executeJavaScript(
      `document.querySelector('[data-section="user-agents"]').click()`,
    );
    checks.push(
      'About version from Electron, fixed external GitHub link, sender validation and visible browser failure',
    );
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#preset-value").readOnly',
      ),
      true,
    );
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#delete-preset").hidden',
      ),
      true,
    );
    await capture(win, 'settings');
    await click(shell, 'new-preset');
    const customName = 'My <TV> & "one"';
    const customUA = 'Tubevra-test/1.0; exact; ';
    await shell.executeJavaScript(
      `document.querySelector('#preset-name').value=${JSON.stringify(customName)};document.querySelector('#preset-value').value=${JSON.stringify(customUA)};document.querySelector('#preset-value').dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#new-preset").disabled',
      ),
      true,
    );
    await click(shell, 'save-preset');
    await waitFor(
      async () => (await state()).userAgents.presets.length === 8,
      'custom added',
    );
    await idle();
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#detail-title").textContent',
      ),
      customName,
    );
    assert.equal(
      await shell.executeJavaScript('document.querySelectorAll("img").length'),
      0,
    );
    await click(shell, 'apply-preset');
    await waitFor(
      async () => (await state()).userAgents.activeId.startsWith('custom:'),
      'custom selected',
    );
    await idle();
    assert.equal(await tv.executeJavaScript('navigator.userAgent'), customUA);
    await tv.executeJavaScript(
      'document.cookie="tubevra_test=kept; Secure; SameSite=Strict"',
    );
    await shell.executeJavaScript(
      `document.querySelector('#preset-value').value='Tubevra-test/2.0';document.querySelector('#preset-value').dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    failNextLoad = true;
    await click(shell, 'save-preset');
    await waitFor(
      async () =>
        (await state()).userAgents.presets.some(
          (entry) => entry.userAgent === 'Tubevra-test/2.0',
        ),
      'active edit persisted',
    );
    await idle();
    assert.ok((await state()).error);
    assert.deepEqual(
      await shell.executeJavaScript(
        '[document.querySelector("#save-preset").disabled, document.querySelector("#discard").hidden, document.querySelector("#feedback").textContent]',
      ),
      [true, true, 'Saved. YouTube TV could not reload. See the error above.'],
    );
    await shell.executeJavaScript('window.tubevra.navigate("home")');
    await idle();
    assert.equal(
      await tv.executeJavaScript('navigator.userAgent'),
      'Tubevra-test/2.0',
    );
    assert.match(
      await tv.executeJavaScript('document.cookie'),
      /tubevra_test=kept/,
    );
    await click(shell, 'delete-preset');
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#confirm-delete").disabled',
      ),
      true,
    );
    await shell.executeJavaScript(
      'document.querySelector("#replacement").value="ps4";document.querySelector("#replacement").dispatchEvent(new Event("change"))',
    );
    for (const [width, height] of [
      [900, 600],
      [640, 680],
    ]) {
      win.setSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 150));
      for (const id of [
        'preset-name',
        'preset-value',
        'confirm-delete',
        'cancel-delete',
      ]) {
        assert.equal(
          await shell.executeJavaScript(`(() => {
          const element = document.getElementById(${JSON.stringify(id)});
          element.scrollIntoView({ block: 'center' });
          const rect = element.getBoundingClientRect();
          return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
        })()`),
          true,
          `${id} must remain reachable at ${width}x${height}`,
        );
      }
    }
    win.setSize(1280, 800);
    failNextLoad = true;
    await click(shell, 'confirm-delete');
    await waitFor(
      async () => (await state()).userAgents.presets.length === 7,
      'custom deleted',
    );
    await idle();
    assert.equal((await state()).userAgents.activeId, 'ps4');
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#delete-confirmation").hidden',
      ),
      true,
    );
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#preset-name").readOnly',
      ),
      true,
    );
    await shell.executeJavaScript('window.tubevra.navigate("home")');
    await idle();
    checks.push(
      'settings CRUD, exact UA application, reload, cookies, explicit replacement, safe text rendering',
    );

    await click(shell, 'done');
    await waitFor(async () => !(await state()).settingsOpen, 'settings closed');
    // Resizing the test window can change native focus on Windows.
    win.focus();
    tv.focus();
    // Synchronize the newly visible native view with a rendered frame before input.
    await tv.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => resolve(document.hasFocus())))',
    );
    await toolbar.executeJavaScript('document.querySelector("#back").click()');
    await waitFor(
      async () => (await tv.executeJavaScript('window.backCount')) === 1,
      'toolbar Back',
    );
    assert.deepEqual(await tv.executeJavaScript('window.keys'), ['Escape']);
    win.focus();
    tv.focus();
    const rightClick = async (x, y) => {
      tv.sendInputEvent({
        type: 'mouseDown',
        x,
        y,
        button: 'right',
        clickCount: 1,
      });
      tv.sendInputEvent({
        type: 'mouseUp',
        x,
        y,
        button: 'right',
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    };
    await tv.executeJavaScript('document.querySelector("#search").focus()');
    const inputPosition = await tv.executeJavaScript(
      '(()=>{const r=document.querySelector("#search").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()',
    );
    await rightClick(inputPosition.x, inputPosition.y);
    assert.equal(await tv.executeJavaScript('window.backCount'), 1);
    await tv.executeJavaScript(
      'document.activeElement.blur();document.dispatchEvent(new CompositionEvent("compositionstart"))',
    );
    await rightClick(450, 400);
    assert.equal(await tv.executeJavaScript('window.backCount'), 1);
    await tv.executeJavaScript(
      'document.dispatchEvent(new CompositionEvent("compositionend"))',
    );
    await rightClick(450, 400);
    await waitFor(
      async () => (await tv.executeJavaScript('window.backCount')) === 2,
      'right-click Back',
    );
    checks.push(
      'Back emits Escape; input and simulated composition guards on local fixture',
    );

    await tv.executeJavaScript(
      `document.querySelector('#player').src = 'https://www.youtube.com/tv/test-audio.wav';
      document.querySelector('#player').play()`,
      true,
    );
    await waitFor(
      async () =>
        (await tv.executeJavaScript(
          'document.querySelector("#player").currentTime',
        )) > 0,
      'local media playback',
    );
    const playbackState = () =>
      tv.executeJavaScript(`({
        visibility: document.visibilityState,
        paused: document.querySelector('#player').paused,
        time: document.querySelector('#player').currentTime,
      })`);
    win.minimize();
    await waitFor(() => win.isMinimized(), 'native window minimization');
    // Wait in the main process so renderer throttling cannot hide a failure.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const minimized = await playbackState();
    assert.equal(minimized.visibility, 'visible');
    assert.equal(minimized.paused, false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok((await playbackState()).time > minimized.time + 0.5);
    win.restore();
    await waitFor(() => !win.isMinimized(), 'native window restoration');
    assert.equal((await playbackState()).paused, false);
    await tv.executeJavaScript('document.querySelector("#player").pause()');
    win.minimize();
    await waitFor(() => win.isMinimized(), 'paused window minimization');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal((await playbackState()).paused, true);
    win.restore();
    await waitFor(() => !win.isMinimized(), 'paused window restoration');
    assert.equal((await playbackState()).paused, true);
    win.focus();
    tv.focus();
    checks.push(
      'media keeps playing while minimized; manual pause survives minimize/restore',
    );

    const toolbarView = win.contentView.children.find(
      (view) => view.webContents === toolbar,
    );
    assert.ok(toolbarView);
    const bounds = toolbarView.getBounds();
    assert.equal(bounds.width, 300);
    assert.equal(bounds.height, 68);
    await tv.executeJavaScript(
      'document.querySelector("#player").requestFullscreen()',
      true,
    );
    await waitFor(
      async () => (await state()).playbackFullscreen,
      'HTML fullscreen',
    );
    assert.equal(toolbarView.getVisible(), false);
    await tv.executeJavaScript('document.exitFullscreen()');
    await waitFor(
      async () => !(await state()).playbackFullscreen,
      'fullscreen exit',
    );
    moveCursor(area.width / 2, win.contentView.getBounds().height - 2);
    win.focus();
    await waitFor(dockShown, 'dock restores after fullscreen');
    checks.push(
      'bounded native toolbar and automatic hide/restore on actual HTML fullscreen',
    );

    await click(toolbar, 'settings');
    await waitFor(async () => (await state()).settingsOpen, 'settings reopen');
    win.setSize(640, 680);
    await capture(win, 'settings-compact');
    assert.equal(
      await shell.executeJavaScript(
        'document.documentElement.scrollWidth > innerWidth',
      ),
      false,
    );
    const badIPC = await shell.executeJavaScript(
      'window.tubevra.setSettingsOpen("bad")',
    );
    assert.equal(badIPC.ok, false);
    assert.equal((await state()).settingsOpen, true);
    failNextLoad = true;
    await shell.executeJavaScript(
      'document.querySelector("[data-preset-id=cobalt]").click()',
    );
    await click(shell, 'apply-preset');
    await waitFor(async () => !!(await state()).error, 'visible load failure');
    await idle();
    assert.equal((await state()).userAgents.activeId, 'cobalt');
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#service-error").hidden',
      ),
      false,
    );
    const saved = JSON.parse(
      fs.readFileSync(path.join(profile, 'user-agents.json'), 'utf8'),
    );
    assert.equal(saved.activeId, 'cobalt');
    checks.push(
      'compact layout, validated visibility IPC, visible reload failure without UA fallback',
    );
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, requests, profile, output }, null, 2));
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ checks, requests, errors, profile }, null, 2),
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    console.error(
      JSON.stringify({ checks, errors, requests, profile, output }),
    );
    app.exit(1);
  });
