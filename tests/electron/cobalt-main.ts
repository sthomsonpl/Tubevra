import { app, BrowserWindow, session, webContents, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  overrideCobaltMediaCapabilities,
  cobaltMediaLimits,
} from '../../src/preload/cobalt-media-capabilities';
import { createTVWindow } from '../../src/main/tv-window';
import { UserAgentStore } from '../../src/main/user-agent-store';
import {
  HARDWARE_CODECS_IPC,
  isHardwareCodecSnapshot,
} from '../../src/shared/media-capabilities';
if (!process.env.TUBEVRA_TEST_PROFILE) throw Error('Use isolated runner');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
app.on('window-all-closed', () => {});
if (process.env.TUBEVRA_TEST_DISABLE_ACCELERATION === '1') {
  app.disableHardwareAcceleration();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(
    path.join(app.getPath('userData'), 'general-settings.json'),
    JSON.stringify({
      version: 1,
      hardwareAcceleration: false,
      playbackResolution: 'auto',
    }),
  );
}
const resultFile = path.resolve('out/verification/cobalt/result.json');
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
const started = Date.now();
app
  .whenReady()
  .then(async () => {
    const ses = session.fromPartition('persist:tubevra-tv');
    ses.protocol.handle(
      'https',
      (request) =>
        new Response(
          `<!doctype html><script>
 window.firstResults={ua:navigator.userAgent,hardwareCodecs:window.__testCodecBootstrap,av1:MediaSource.isTypeSupported('video/mp4;codecs="av01.0.13M.08";width=640;framerate=30'),vp9profile2:MediaSource.isTypeSupported('video/mp4;codecs="vp09.02.51.10";width=640'),absurd:MediaSource.isTypeSupported('video/webm;codecs="vp9";framerate=9999'),valid:MediaSource.isTypeSupported('video/webm;codecs="vp9";framerate=59.94'),codec:MediaSource.isTypeSupported('video/webm;codecs="nonexistent";width=640'),node:typeof require};
 </script><h1>Local Cobalt compatibility fixture</h1>${request.url.endsWith('/frame') ? '' : '<iframe src="https://www.youtube.com/tv/frame"></iframe>'}`,
          { headers: { 'Content-Type': 'text/html' } },
        ),
    );
    const getGPUInfo = app.getGPUInfo.bind(app);
    let codecProbes = 0;
    app.getGPUInfo = (type) => {
      codecProbes++;
      if (codecProbes === 1)
        return Promise.reject(Error('Forced codec discovery failure'));
      return getGPUInfo(type);
    };
    await createTVWindow(await UserAgentStore.open(app.getPath('userData')));
    const tv = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('https://www.youtube.com/tv'))!;
    const shell = BrowserWindow.getAllWindows()[0].webContents;
    const read = () => tv.executeJavaScript('window.firstResults');
    const nativeAV1 = await shell.executeJavaScript(
      `MediaSource.isTypeSupported('video/mp4;codecs="av01.0.13M.08"')`,
    );
    const assertHardwareFiltering = async () => {
      const current = await read();
      const hardware = current.hardwareCodecs;
      assert.equal(
        current.av1,
        nativeAV1 &&
          (hardware?.status !== 'ready' ||
            hardware.profiles.includes('av1 profile main')),
      );
      const nativeVP9 = await shell.executeJavaScript(
        `MediaSource.isTypeSupported('video/mp4;codecs="vp09.02.51.10"')`,
      );
      assert.equal(
        current.vp9profile2,
        nativeVP9 &&
          (hardware?.status !== 'ready' ||
            hardware.profiles.includes('vp9 profile2')),
      );
    };
    if (process.env.TUBEVRA_TEST_DISABLE_ACCELERATION === '1') {
      assert.equal((await read()).hardwareCodecs.status, 'disabled');
      await assertHardwareFiltering();
      assert.equal(codecProbes, 0);
      await shell.executeJavaScript(
        'window.tubevra.setHardwareAcceleration(true)',
      );
      await shell.executeJavaScript('window.tubevra.reloadTV()');
      const state = (await shell.executeJavaScript('window.tubevra.getState()'))
        .value;
      assert.equal(state.general.restartRequired, true);
      assert.equal(state.codecWarning, null);
      assert.equal(state.error, null);
      assert.equal((await read()).hardwareCodecs.status, 'disabled');
      assert.equal(codecProbes, 0);
      fs.writeFileSync(
        resultFile,
        JSON.stringify({
          passed: true,
          checks: [
            'disabled startup bootstrap, pending restart preserves disabled runtime, no GPU probe',
          ],
        }),
      );
      console.log('Cobalt disabled startup bootstrap passed');
      app.exit(0);
      return;
    }
    const failedBootstrap = await read();
    await assertHardwareFiltering();
    assert.equal(failedBootstrap.hardwareCodecs.status, 'error');
    const fallbackState = (
      await shell.executeJavaScript('window.tubevra.getState()')
    ).value;
    assert.equal(fallbackState.loading, false);
    assert.equal(fallbackState.error, null);
    assert.match(fallbackState.codecWarning, /Forced codec discovery failure/);
    assert.match(
      await shell.executeJavaScript(
        'document.querySelector("#service-error").textContent',
      ),
      /Native codec support/,
    );
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.reloadTV()')).ok,
      true,
    );
    assert.equal((await read()).hardwareCodecs.status, 'ready');
    await assertHardwareFiltering();
    assert.ok(isHardwareCodecSnapshot((await read()).hardwareCodecs));
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.getState()')).value
        .codecWarning,
      null,
    );
    assert.equal(codecProbes, 2);
    assert.equal(
      await tv.mainFrame.frames[0].executeJavaScript(
        'window.firstResults.hardwareCodecs == null',
      ),
      true,
    );
    // Wrong frame and local shell must not be able to read the bootstrap.
    for (const event of [
      { sender: shell, senderFrame: shell.mainFrame },
      { sender: tv, senderFrame: tv.mainFrame.frames[0] },
    ]) {
      ipcMain.emit(HARDWARE_CODECS_IPC.bootstrap, event);
      assert.equal((event as any).returnValue.ok, false);
    }
    // Saved preference awaiting restart must not change the current runtime snapshot.
    await shell.executeJavaScript(
      'window.tubevra.setHardwareAcceleration(false)',
    );
    await shell.executeJavaScript('window.tubevra.reloadTV()');
    assert.equal((await read()).hardwareCodecs.status, 'ready');
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.getState()')).value.general
        .restartRequired,
      true,
    );
    await shell.executeJavaScript(
      'window.tubevra.setHardwareAcceleration(true)',
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    const auto = await tv.executeJavaScript(
      '({width:Math.round(screen.width*devicePixelRatio),height:Math.round(screen.height*devicePixelRatio)})',
    );
    for (const [mode, height] of [
      ['1440p', 1440],
      ['4k', 2160],
      ['8k', 4320],
      ['auto', auto.height],
    ] as const) {
      const result = await shell.executeJavaScript(
        `window.tubevra.setPlaybackResolution('${mode}')`,
      );
      assert.equal(result.ok, true);
      assert.equal(result.value.settingsOpen, true);
      assert.equal(result.value.general.restartRequired, false);
      const actual = await tv.executeJavaScript(
        '({width:Math.round(screen.width*devicePixelRatio),height:Math.round(screen.height*devicePixelRatio)})',
      );
      assert.equal(actual.height, height);
      assert.ok(
        Math.abs(
          actual.width - Math.round((auto.width * height) / auto.height),
        ) <= 2,
      );
      assert.equal(
        await shell.executeJavaScript(
          'document.querySelector("#playback-resolution").value',
        ),
        mode,
      );
    }
    assert.equal(
      (
        await shell.executeJavaScript(
          'window.tubevra.setPlaybackResolution("bad")',
        )
      ).ok,
      false,
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    const handler = ipcMain._invokeHandlers.get(
      'tubevra:set-playback-resolution',
    );
    assert.throws(
      () => handler({ sender: tv, senderFrame: tv.mainFrame }, '4k'),
      /Untrusted/,
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(true)');
    await shell.executeJavaScript(
      'document.querySelector("[data-section=general]").click(); const select=document.querySelector("#playback-resolution"); select.value="8k"; select.dispatchEvent(new Event("change",{bubbles:true}));',
    );
    for (let i = 0; i < 200; i++) {
      if (
        await shell.executeJavaScript(
          '!document.querySelector("#playback-resolution").disabled',
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#playback-resolution").value',
      ),
      '8k',
    );
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.getState()')).value.general
        .playbackResolution,
      '8k',
    );
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(640, 680);
    win.show();
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (process.env.TUBEVRA_TEST_SKIP_CAPTURE === '1')
      console.warn(
        'Settings screenshot explicitly skipped; layout capture remains unverified.',
      );
    else
      fs.writeFileSync(
        path.resolve('out/verification/cobalt/resolution-settings.png'),
        (
          await shell.capturePage().catch((cause) => {
            throw Error(`Settings screenshot failed: ${String(cause)}`);
          })
        ).toPNG(),
      );
    await shell.executeJavaScript(
      'window.tubevra.setPlaybackResolution("auto")',
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    const initial = await read();
    assert.equal(
      codecProbes,
      2,
      'resolution changes must reuse profile discovery',
    );
    assert.equal(initial.absurd, false);
    assert.equal(initial.valid, true);
    assert.equal(initial.codec, false);
    assert.equal(initial.node, 'undefined');
    assert.equal(
      await tv.mainFrame.frames[0].executeJavaScript(
        'window.firstResults.absurd',
      ),
      true,
    );
    assert.equal(
      await shell.executeJavaScript(
        'MediaSource.isTypeSupported(\'video/webm;codecs="vp9";framerate=9999\')',
      ),
      true,
    );
    for (const id of ['lg_webos', 'cobalt', 'lg_webos', 'ps4']) {
      const result = await shell.executeJavaScript(
        `window.tubevra.updateUserAgents({type:'select',id:${JSON.stringify(id)}})`,
      );
      assert.equal(result.ok, true);
      assert.equal((await read()).absurd, id === 'lg_webos');
      await assertHardwareFiltering();
      assert.equal(
        (await read()).hardwareCodecs?.status,
        id === 'lg_webos' ? undefined : 'ready',
      );
    }
    const added = await shell.executeJavaScript(
      `window.tubevra.updateUserAgents({type:'add',name:'Custom Cobalt',userAgent:'Custom cobalt/27'})`,
    );
    assert.equal(added.ok, true);
    const custom = added.value.userAgents.presets.find(
      (p: any) => p.name === 'Custom Cobalt',
    ).id;
    await shell.executeJavaScript(
      `window.tubevra.updateUserAgents({type:'select',id:${JSON.stringify(custom)}})`,
    );
    assert.equal((await read()).absurd, false);
    assert.equal(codecProbes, 2, 'UA transitions must reuse profile discovery');
    const concurrent = await shell.executeJavaScript(`Promise.all([
      window.tubevra.setPlaybackResolution('4k'),
      window.tubevra.updateUserAgents({type:'select',id:'lg_webos'})
    ])`);
    assert.ok(concurrent.every((result: any) => result.ok));
    assert.equal((await read()).hardwareCodecs, undefined);
    await shell.executeJavaScript(
      `window.tubevra.updateUserAgents({type:'select',id:${JSON.stringify(custom)}})`,
    );
    assert.equal((await read()).hardwareCodecs.status, 'ready');
    assert.equal(codecProbes, 2);
    app.emit('child-process-gone', {}, { type: 'GPU' });
    assert.match(
      (await shell.executeJavaScript('window.tubevra.getState()')).value
        .codecWarning,
      /GPU process stopped/,
    );
    await shell.executeJavaScript('window.tubevra.reloadTV()');
    assert.equal((await read()).hardwareCodecs.status, 'ready');
    assert.equal(codecProbes, 3, 'GPU loss must invalidate cached discovery');
    const failurePreload = path.join(
      app.getPath('userData'),
      'failure-preload.cjs',
    );
    fs.writeFileSync(
      failurePreload,
      `require('electron').contextBridge.executeInMainWorld({func:()=>{Object.defineProperty(MediaSource,'isTypeSupported',{value:MediaSource.isTypeSupported,writable:false,configurable:false}); (${overrideCobaltMediaCapabilities.toString()})(${JSON.stringify(cobaltMediaLimits({ width: 1920, height: 1080 }))});}});`,
    );
    const broken = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        preload: failurePreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const failure = new Promise<Error>((resolve) =>
      broken.webContents.once('preload-error', (_event, _file, error) =>
        resolve(error),
      ),
    );
    await broken.loadURL('https://www.youtube.com/tv/failure');
    const installationError = await failure;
    assert.match(installationError.message, /redefine/);
    broken.destroy();
    // Verify the owning TV view's handler publishes the real installation error.
    tv.emit('preload-error', {}, failurePreload, installationError);
    const failureState = await shell.executeJavaScript(
      'window.tubevra.getState()',
    );
    assert.match(failureState.value.error, /YouTube preload failed:.*redefine/);
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#service-error").hidden',
      ),
      false,
    );
    await new Promise<void>((resolve, reject) => {
      tv.once('did-finish-load', () => resolve());
      tv.once('did-fail-load', () => reject(Error('reload failed')));
      tv.reload();
    });
    assert.equal((await read()).absurd, false);
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents === shell)!
      .destroy();
    assert.equal(ipcMain.listenerCount(HARDWARE_CODECS_IPC.bootstrap), 0);
    assert.equal(ipcMain.listenerCount(HARDWARE_CODECS_IPC.failure), 0);
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        passed: true,
        screenshotSkipped: process.env.TUBEVRA_TEST_SKIP_CAPTURE === '1',
        elapsedMs: Date.now() - started,
        checks: [
          'first page script',
          'native AV1/VP9 profile filtering and error/disabled fallback before first page script',
          'hardware codec bootstrap before first script, failure/retry and GPU invalidation',
          'runtime acceleration independent of pending preference, cached UA/resolution transitions',
          'native codec rejection',
          'UA transitions and custom UA',
          'reload',
          'subframe and shell isolation',
          'sandbox',
          'real preload-error and local error surface',
        ],
      }),
    );
    console.log(
      'Cobalt Electron passed: first page script, native codecs, UA switches, custom UA, reload, sandbox',
    );
    app.exit(0);
  })
  .catch((error) => {
    fs.writeFileSync(
      resultFile,
      JSON.stringify({ passed: false, error: String(error.stack ?? error) }),
    );
    console.error(error);
    app.exit(1);
  });
