import { app, BrowserWindow, session, webContents } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createTVWindow } from '../../src/main/tv-window';
import { UserAgentStore } from '../../src/main/user-agent-store';

if (!process.env.TUBEVRA_TEST_PROFILE || !process.env.TUBEVRA_TEST_RESULT)
  throw Error('Use the isolated packaged hook runner.');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
let lastState: unknown;
async function waitFor(check: () => Promise<boolean>) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(
    'Timed out waiting for packaged hook state: ' + JSON.stringify(lastState),
  );
}
app
  .whenReady()
  .then(async () => {
    assert.equal(app.isPackaged, process.env.TUBEVRA_TEST_PACKAGED === '1');
    const feed = JSON.stringify({
      contents: {
        sectionListRenderer: {
          contents: [{ adSlotRenderer: {} }, { feedNudgeRenderer: {} }],
        },
      },
    });
    const first = `window.payload = '{"playabilityStatus":{},"streamingData":{},"adPlacements":[{"adPlacementRenderer":{}}],"adSlots":[{"adSlotRenderer":{}}],"captions":{"kept":true}}'; window.retained = JSON.parse; window.firstResult = JSON.parse(payload); window.firstFeed = JSON.parse(${JSON.stringify(feed)});`;
    const hash = createHash('sha256').update(first).digest('base64');
    let requests = 0;
    const failures: string[] = [];
    app.on('web-contents-created', (_event, contents) => {
      contents.on('preload-error', (_e, _p, error) =>
        failures.push(String(error)),
      );
    });
    await session
      .fromPartition('persist:tubevra-tv')
      .protocol.handle('https', () => {
        requests++;
        return new Response(
          `<!doctype html><script>${first}</script><script>window.forbidden=true</script>`,
          {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'`,
            },
          },
        );
      });
    await createTVWindow(await UserAgentStore.open(app.getPath('userData')));
    await waitFor(async () =>
      webContents
        .getAllWebContents()
        .some((c) => c.getURL().startsWith('https://www.youtube.com/tv')),
    );
    const shell = BrowserWindow.getAllWindows()[0].webContents;
    const tv = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('https://www.youtube.com/tv'))!;
    const state = async () =>
      (lastState = await shell.executeJavaScript(
        'window.tubevra.getExtensions().then(r=>r.value)',
      ));
    const toggle = () =>
      shell.executeJavaScript(
        'document.querySelector("#panel-extensions input").click()',
      );
    const text = () =>
      shell.executeJavaScript(
        'document.querySelector("#panel-extensions").textContent',
      );
    await waitFor(async () => (await state()).items[0]?.status === 'active');
    const sponsorState = async () =>
      (await state()).items.find(
        (item: { id: string }) => item.id === 'sponsorblock',
      );
    assert.equal((await sponsorState()).enabled, false);
    assert.equal((await sponsorState()).status, 'disabled');
    for (const enabled of [true, false, true, false]) {
      const result = await shell.executeJavaScript(
        `window.tubevra.setExtensionEnabled({id:'sponsorblock',enabled:${enabled}})`,
      );
      assert.equal(result.ok, true);
      await waitFor(
        async () =>
          (await sponsorState()).status === (enabled ? 'active' : 'disabled'),
      );
      assert.equal((await sponsorState()).reloadRequired, false);
      assert.equal((await state()).items[0].status, 'active');
    }
    const parse = () =>
      tv.executeJavaScript('JSON.parse(payload).adSlots.length');
    assert.equal(await tv.executeJavaScript('firstResult.adSlots.length'), 0);
    assert.equal(
      await tv.executeJavaScript('firstResult.adPlacements.length'),
      0,
    );
    assert.equal(await tv.executeJavaScript('firstResult.captions.kept'), true);
    assert.deepEqual(
      await tv.executeJavaScript(
        'firstFeed.contents.sectionListRenderer.contents',
      ),
      [{ feedNudgeRenderer: {} }],
    );
    await tv.executeJavaScript('location.hash = "#/watch"');
    assert.equal(await parse(), 0);
    await waitFor(async () => (await state()).items[0].reloadRequired);
    assert.equal(
      await tv.executeJavaScript('typeof window.forbidden'),
      'undefined',
    );
    assert.equal(
      await tv.executeJavaScript(
        'typeof require + ":" + typeof window.tubevra',
      ),
      'undefined:undefined',
    );
    const prefs = tv.getLastWebPreferences();
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.nodeIntegration, false);
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    await shell.executeJavaScript(
      'document.querySelector("[data-section=extensions]").click()',
    );
    await toggle();
    await waitFor(async () => (await state()).items[0].status === 'disabled');
    assert.equal((await state()).items[0].enabled, false);
    assert.equal((await state()).items[0].reloadRequired, true);
    assert.match(await text(), /Disabled.*Reload required/);
    assert.equal(await parse(), 1);
    assert.equal(
      await tv.executeJavaScript('retained(payload).adSlots.length'),
      1,
    );
    const saved = JSON.parse(
      readFileSync(app.getPath('userData') + '/extensions.json', 'utf8'),
    );
    assert.equal(saved.enabled.adblock, false);
    await tv.loadURL('https://www.youtube.com/tv');
    await waitFor(async () => (await state()).items[0].status === 'disabled');
    assert.equal(await tv.executeJavaScript('firstResult.adSlots.length'), 1);
    const before = requests;
    await toggle();
    await waitFor(async () => (await state()).items[0].reloadRequired);
    assert.equal(requests, before);
    assert.match(await text(), /Starts after reload/);
    assert.equal((await state()).items[0].enabled, true);
    assert.equal(
      JSON.parse(
        readFileSync(app.getPath('userData') + '/extensions.json', 'utf8'),
      ).enabled.adblock,
      true,
    );
    await tv.executeJavaScript(
      'location.hash = "#/watch"; document.cookie="fixture=kept; Secure; SameSite=Strict"',
    );
    const ua = tv.getUserAgent();
    await waitFor(async () =>
      shell.executeJavaScript(
        '!document.querySelector("#panel-extensions button").disabled',
      ),
    );
    await shell.executeJavaScript(
      'document.querySelector("#panel-extensions button").click()',
    );
    await waitFor(async () => (await state()).items[0].status === 'active');
    assert.equal(await tv.executeJavaScript('firstResult.adSlots.length'), 0);
    assert.match(tv.getURL(), /#\/watch$/);
    assert.equal(tv.getUserAgent(), ua);
    assert.match(await tv.executeJavaScript('document.cookie'), /fixture=kept/);
    await waitFor(async () => (await state()).items[0].reloadRequired);
    await tv.executeJavaScript(
      `JSON.parse('{"playabilityStatus":{},"streamingData":{},"adSlots":false}')`,
    );
    await waitFor(async () => (await state()).items[0].status === 'error');
    await waitFor(async () =>
      (await text()).includes('incompatible player field adSlots'),
    );
    assert.match(await text(), /Reload required/);
    assert.equal((await state()).items[0].enabled, true);
    assert.equal(await parse(), 1);
    assert.equal(
      await tv.executeJavaScript('retained(payload).adSlots.length'),
      1,
    );
    await toggle();
    await waitFor(async () => !(await state()).items[0].enabled);
    assert.equal((await state()).items[0].reloadRequired, true);
    assert.deepEqual(failures, []);
    writeFileSync(
      process.env.TUBEVRA_TEST_RESULT!,
      JSON.stringify({
        passed: true,
        checks: [
          'production Adblock and serialized player/feed helpers',
          'SponsorBlock default state, repeated toggles and Adblock coexistence',
          'first script',
          'CSP',
          'isolation',
          'real settings and hook reports',
          'cleanup',
          'deferred enable',
          'explicit reload',
          'route/UA/session',
          'simultaneous error and reload; reload survives disable',
        ],
      }),
    );
    app.exit(0);
  })
  .catch((error) => {
    writeFileSync(
      process.env.TUBEVRA_TEST_RESULT!,
      JSON.stringify({ passed: false, error: String(error.stack ?? error) }),
    );
    app.exit(1);
  });
