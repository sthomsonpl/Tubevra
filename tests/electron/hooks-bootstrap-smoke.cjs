const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const { createHash } = require('node:crypto');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
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
const { connectPage } = require('../../src/extensions/main/page-bridge.ts');
if (!process.env.TUBEVRA_TEST_PROFILE) throw Error('Use isolated runner');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
app
  .whenReady()
  .then(async () => {
    let bridge;
    const reports = [];
    const first =
      'window.firstResult = typeof fixtureCall === "function" ? fixtureCall(5) : null; window.nodeAccess = typeof require;';
    const hash = createHash('sha256').update(first).digest('base64');
    const ses = session.fromPartition('bootstrap-test');
    ses.protocol.handle('https', (request) =>
      request.url.endsWith('/redirect')
        ? new Response(null, {
            status: 302,
            headers: { Location: 'https://www.youtube.com/tv' },
          })
        : new Response(
            `<!doctype html><script>${first}</script><script>window.forbidden = true</script>`,
            {
              headers: {
                'Content-Type': 'text/html',
                'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'`,
              },
            },
          ),
    );
    const engine = await TubervaExtensions.open(
      process.env.TUBEVRA_TEST_PROFILE,
      [
        {
          id: 'sample',
          name: 'Fixture',
          description: 'Test only',
          modes: ['tv'],
          main: false,
          page: false,
          hooks: true,
          defaultEnabled: true,
        },
      ],
      ses.webRequest,
      {},
      () => bridge?.publish(),
      ['sample'],
    );
    const reportHook = engine.reportHook.bind(engine);
    engine.reportHook = (value) => {
      reports.push(value);
      reportHook(value);
    };
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        preload: path.resolve('out/verification/hooks-bootstrap/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const contents = win.webContents;
    const failures = [];
    contents.on('preload-error', (_e, _p, error) =>
      failures.push(String(error)),
    );
    bridge = connectPage(ipcMain, contents, engine);
    const read = () =>
      contents.executeJavaScript(
        '({ first: window.firstResult, hook: typeof fixtureCall, node: window.nodeAccess, forbidden: typeof window.forbidden })',
      );
    const load = async (url) => {
      await contents.loadURL(url);
      assert.deepEqual(failures, []);
      return read();
    };
    let result = await load('https://www.youtube.com/tv');
    assert.equal(result.first, 12);
    assert.equal(result.node, 'undefined');
    assert.equal(result.forbidden, 'undefined');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const firstDocument = reports.at(-1).document;
    await contents.executeJavaScript(
      'window.beforeHook = fixtureCall; location.hash = "#/watch"',
    );
    assert.equal((await read()).first, 12);
    assert.equal(
      await contents.executeJavaScript('window.beforeHook === fixtureCall'),
      true,
    );
    await engine.update({ id: 'sample', enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await read()).hook, 'undefined');
    await engine.update({ id: 'sample', enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await read()).hook, 'undefined');
    assert.match(reports.at(-1).reloadReason, /new document/);
    result = await load('https://www.youtube.com/tv');
    assert.equal(result.first, 12);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.notEqual(reports.at(-1).document, firstDocument);
    contents.setUserAgent('Tubevra fixture UA');
    result = await load('https://www.youtube.com/tv/redirect');
    assert.equal(result.first, 12);
    assert.equal(contents.getURL(), 'https://www.youtube.com/tv');
    await engine.update({ id: 'sample', enabled: false });
    result = await load('https://www.youtube.com/tv');
    assert.equal(result.first, null);
    bridge.dispose();
    await engine.dispose();
    win.destroy();
    console.log(
      'Production hook bootstrap passed: early IPC URL, first script, CSP, toggles, reload, SPA, UA, redirect',
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
