const { app, BrowserWindow, WebContentsView, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
if (!process.env.TUBEVRA_TEST_PROFILE) throw Error('Use isolated test runner');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
const first = `window.firstResult = fixtureCall(5); window.isolation = [typeof require, typeof process, typeof ipcRenderer, typeof tubevra, typeof electron];`;
const hash = createHash('sha256').update(first).digest('base64');
app
  .whenReady()
  .then(async () => {
    assert.equal(process.versions.electron, '45.0.0');
    const ses = session.fromPartition('hooks-test');
    ses.protocol.handle(
      'https',
      () =>
        new Response(
          `<!doctype html><script>${first}</script><script>window.forbiddenRan = true</script><title>Hooks fixture</title>`,
          {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'; object-src 'none'; base-uri 'none'`,
            },
          },
        ),
    );
    const win = new BrowserWindow({ show: false });
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: path.resolve('out/verification/hooks/hooks-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.contentView.addChildView(view);
    const failures = [];
    view.webContents.on('preload-error', (_event, _path, error) =>
      failures.push(String(error)),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await view.webContents.loadURL('https://www.youtube.com/tv');
      const result = await view.webContents.executeJavaScript(
        `({ first: window.firstResult, isolation: window.isolation, forbidden: typeof window.forbiddenRan, stopped: typeof window.fixtureCall, proof: document.documentElement.dataset.hookProof })`,
      );
      assert.deepEqual(failures, []);
      assert.equal(
        result.first,
        12,
        'First inline script must see the installed main-world hook',
      );
      assert.deepEqual(result.isolation, Array(5).fill('undefined'));
      assert.equal(
        result.forbidden,
        'undefined',
        'CSP must actually block unapproved inline scripts',
      );
      assert.equal(result.stopped, 'undefined');
      assert.equal(JSON.parse(result.proof).calls, 1);
    }
    win.destroy();
    console.log(
      'Hooks proof passed: Electron 45, synchronous first-script interception, strict CSP, isolation, private control/reporting, cleanup, new document',
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
