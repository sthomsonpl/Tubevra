import { app, BrowserWindow, session, webContents } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
    assert.equal(app.isPackaged, true);
    const first =
      'window.firstResult = typeof fixtureCall === "function" ? fixtureCall(5) : null;';
    const hash = createHash('sha256').update(first).digest('base64');
    let requests = 0;
    const failures: string[] = [];
    app.on('web-contents-created', (_event, contents) => {
      contents.on('preload-error', (_e, _p, error) =>
        failures.push(String(error)),
      );
    });
    if (process.env.TUBEVRA_TEST_LIVE !== '1')
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
    if (process.env.TUBEVRA_TEST_LIVE === '1') {
      assert.equal(await tv.executeJavaScript('fixtureCall(5)'), 12);
      assert.deepEqual(failures, []);
      writeFileSync(
        process.env.TUBEVRA_TEST_RESULT!,
        JSON.stringify({
          passed: true,
          checks: ['packaged hook active on real YouTube TV'],
          unverified: [
            'live first-script timing',
            'playback',
            'Back',
            'physical IME',
            'macOS',
            'Linux',
          ],
        }),
      );
      app.exit(0);
      return;
    }
    assert.equal(await tv.executeJavaScript('window.firstResult'), 12);
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
    assert.equal(await tv.executeJavaScript('typeof fixtureCall'), 'undefined');
    const before = requests;
    await toggle();
    await waitFor(async () => (await state()).items[0].reloadRequired);
    assert.equal(requests, before);
    assert.match(await text(), /Starts after reload/);
    assert.equal((await state()).items[0].enabled, true);
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
    assert.equal(await tv.executeJavaScript('window.firstResult'), 12);
    assert.match(tv.getURL(), /#\/watch$/);
    assert.equal(tv.getUserAgent(), ua);
    assert.match(await tv.executeJavaScript('document.cookie'), /fixture=kept/);
    assert.equal((await state()).items[0].reloadRequired, false);
    await tv.executeJavaScript(
      'window.dispatchEvent(new Event("fixture-fail"))',
    );
    await waitFor(async () => (await state()).items[0].status === 'error');
    await waitFor(async () => (await text()).includes('Fixture hook failed.'));
    assert.match(await text(), /Reload required/);
    assert.equal((await state()).items[0].enabled, true);
    assert.equal(await tv.executeJavaScript('typeof fixtureCall'), 'undefined');
    await toggle();
    await waitFor(async () => !(await state()).items[0].enabled);
    assert.equal((await state()).items[0].reloadRequired, true);
    assert.deepEqual(failures, []);
    writeFileSync(
      process.env.TUBEVRA_TEST_RESULT!,
      JSON.stringify({
        passed: true,
        checks: [
          'packaged executable',
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
