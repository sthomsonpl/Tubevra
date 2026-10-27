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
const {
  connectSponsorSegments,
} = require('../../src/extensions/sponsorblock/bridge.ts');
const {
  sponsorMainContext,
} = require('../../src/extensions/sponsorblock/main.ts');
const {
  sponsorAvailability,
} = require('../../src/extensions/sponsorblock/diagnostics.ts');
const {
  createSponsorCoordinator,
} = require('../../src/extensions/sponsorblock/service.ts');
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
    let sponsorCalls = 0,
      sponsorAbort,
      finishSponsor;
    let sponsorTime = 0,
      sponsorFail = false;
    const sponsorCoordinator = createSponsorCoordinator(
      (prefix, signal) => {
        assert.equal(prefix, '7eec');
        sponsorCalls++;
        sponsorAbort = signal;
        if (finishSponsor === true)
          return new Promise((resolve) => {
            finishSponsor = resolve;
          });
        return sponsorFail
          ? { kind: 'network-error' }
          : { kind: 'response', status: 404, body: new Uint8Array() };
      },
      { monotonic: () => sponsorTime, wall: () => 0 },
    );
    let mainResources = 0,
      bridge;
    const engine = await TubervaExtensions.open(
      profile,
      [
        {
          id: 'sponsorblock',
          name: 'Test SponsorBlock',
          description: 'fixture only, no HTTP',
          modes: ['tv'],
          main: true,
          page: true,
          defaultEnabled: true,
        },
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
        sponsorblock: (context) => {
          const sponsor = sponsorMainContext(context);
          const instance = sponsorCoordinator.start(
            sponsor.reportSponsorAvailability,
          );
          sponsor.registerSponsorSegments(instance.get);
          return () => instance.dispose();
        },
        sample: () => {
          mainResources++;
          return () => {
            mainResources--;
          };
        },
      },
      () => bridge?.publish(),
    );
    bridge = connectPage(ipcMain, win.webContents, engine, {
      sponsorblock: connectSponsorSegments,
    });
    await win.loadURL('https://www.youtube.com/tv');
    const sample = () =>
      engine.snapshot().items.find((item) => item.id === 'sample');
    const sponsor = () =>
      engine.snapshot().items.find((item) => item.id === 'sponsorblock');
    await wait(
      () => sample().status === 'active' && sponsor().status === 'active',
    );
    await wait(
      async () =>
        (await win.webContents.executeJavaScript(
          'document.documentElement.dataset.sponsorResult',
        )) === 'empty',
    );
    assert.equal(sponsorCalls, 1);
    assert.equal(sponsorAvailability(sponsor()), 'available');
    const initialRevision = engine.snapshot().revision;
    sponsorTime += 121000;
    sponsorFail = true;
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-sponsor-request'))",
    );
    await wait(() => sponsorAvailability(sponsor()) === 'network-error');
    assert.equal(engine.snapshot().revision, initialRevision);
    assert.equal(sponsor().status, 'active');
    assert.equal(sponsor().error, null);
    sponsorTime += 30000;
    sponsorFail = false;
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-sponsor-request'))",
    );
    await wait(() => sponsorAvailability(sponsor()) === 'available');
    assert.equal(
      await win.webContents.executeJavaScript(`
      typeof window.tubevra === 'undefined' &&
      typeof window.getSponsorSegments === 'undefined' &&
      typeof window.require === 'undefined' &&
      typeof window.process === 'undefined'
    `),
      true,
    );
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
    await wait(() => sample().status === 'active');
    sponsorTime += 121000;
    const nextCalls = sponsorCalls + 1;
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-sponsor-request'))",
    );
    await wait(() => sponsorCalls === nextCalls);
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.documentElement.dataset.sponsorStarts',
      ),
      '1',
    );
    finishSponsor = true;
    sponsorTime += 121000;
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-sponsor-request'))",
    );
    await wait(() => typeof finishSponsor === 'function');
    await engine.update({ id: 'sponsorblock', enabled: false });
    assert.equal(sponsorAbort.aborted, true);
    finishSponsor({ kind: 'response', status: 404, body: new Uint8Array() });
    finishSponsor = undefined;
    const afterEnable = sponsorCalls + 1;
    await engine.update({ id: 'sponsorblock', enabled: true });
    await wait(
      () => sponsor().status === 'active' && sponsorCalls === afterEnable,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.documentElement.dataset.sponsorStarts',
      ),
      '2',
    );
    await win.loadURL('https://www.youtube.com/tv', {
      userAgent: 'Tubevra runtime test UA',
    });
    await wait(
      () => sample().status === 'active' && sponsor().status === 'active',
    );
    let confirmStopped;
    const stopped = new Promise((resolve) => {
      confirmStopped = resolve;
    });
    const originalReport = engine.reportPage.bind(engine);
    engine.reportPage = async (report) => {
      const result = await originalReport(report);
      if (report.status === 'disabled') confirmStopped();
      return result;
    };
    await win.webContents.executeJavaScript(
      "document.dispatchEvent(new Event('fixture-error'))",
    );
    await wait(() => sample().status === 'error');
    assert.equal(sponsor().error, null);
    assert.equal(mainResources, 0);
    await stopped;
    bridge.dispose();
    await engine.dispose();
    win.destroy();
    console.log(
      'Runtime Electron integration passed: main/page, SponsorBlock private capability, service failure/recovery, renewal, cancellation, toggles, UA reload, callback failure, shutdown',
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
