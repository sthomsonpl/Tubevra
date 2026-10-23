// Integration test against the production bundles. YouTube is replaced only
// inside this test process by a local TV fixture; this is not a live-site test.
const {
  app,
  BrowserWindow,
  webContents,
  session,
  desktopCapturer,
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
const fixture = `<!doctype html><meta charset="utf-8"><title>Local TV fixture</title>
<style>body{margin:0;background:linear-gradient(120deg,#142837,#466360 45%,#392d4c);color:white;font:20px sans-serif;height:100vh}h1{padding:60px 60px 0}input{margin:30px 60px;padding:10px}#player{background:#151515;width:300px;height:180px;margin:0 60px}footer{position:absolute;bottom:0;height:110px;width:100%;background:repeating-linear-gradient(90deg,#497e9d 0 12px,#16334b 12px 24px)}</style>
<h1>Local TV integration fixture</h1><input id="search" aria-label="Search"/><video id="player"></video><footer></footer>
<script>window.backCount=0;window.keys=[];document.addEventListener('keydown',e=>{window.keys.push(e.key);if(e.key==='Escape')window.backCount++});</script>`;

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
    await session
      .fromPartition('persist:tubevra-tv')
      .protocol.handle('https', (request) => {
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
    require('../../out/Tubevra-win32-x64/resources/app.asar/.vite/build/main.cjs');
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
    assert.equal(toolbarView.getVisible(), true);
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
