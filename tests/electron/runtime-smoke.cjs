const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
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
const profile = process.env.TUBEVRA_TEST_PROFILE;
if (!profile) throw Error('Use isolated test runner');
app.setPath('userData', profile);
async function wait(check) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > 10000) throw Error('Runtime integration timeout');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
app
  .whenReady()
  .then(async () => {
    const ses = session.fromPartition('runtime-test');
    await ses.protocol.handle(
      'https',
      () => new Response('<!doctype html><title>Runtime fixture</title>'),
    );
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        preload: path.resolve('out/verification/runtime/runtime-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    let mainResources = 0,
      bridge;
    const engine = await TubervaExtensions.open(
      profile,
      [
        {
          id: 'sample',
          name: 'Sample',
          description: 'test only',
          modes: ['tv'],
          main: true,
          page: true,
          defaultEnabled: true,
        },
      ],
      ses.webRequest,
      {
        sample: () => {
          mainResources++;
          return () => {
            mainResources--;
          };
        },
      },
      () => bridge?.publish(),
    );
    bridge = connectPage(ipcMain, win.webContents, engine);
    await win.loadURL('https://www.youtube.com/tv');
    await wait(() => engine.snapshot().items[0].status === 'active');
    assert.equal(mainResources, 1);
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.documentElement.dataset.extension',
      ),
      'active',
    );
    await engine.update({ id: 'sample', enabled: false });
    await wait(
      async () =>
        !(await win.webContents.executeJavaScript(
          'document.documentElement.dataset.extension',
        )),
    );
    assert.equal(mainResources, 0);
    await engine.update({ id: 'sample', enabled: true });
    await wait(() => engine.snapshot().items[0].status === 'active');
    await win.loadURL('https://www.youtube.com/tv', {
      userAgent: 'Tubevra runtime test UA',
    });
    await wait(() => engine.snapshot().items[0].status === 'active');
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-error'))",
    );
    await wait(() => engine.snapshot().items[0].status === 'error');
    assert.equal(mainResources, 0);
    bridge.dispose();
    await engine.dispose();
    win.destroy();
    console.log(
      'Runtime Electron integration passed: main/page, toggles, UA reload, callback failure, shutdown',
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
