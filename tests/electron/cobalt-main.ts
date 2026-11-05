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
let phase = 'Electron ready';
setTimeout(() => {
  fs.writeFileSync(
    resultFile,
    JSON.stringify({ passed: false, error: `Timed out during ${phase}` }),
  );
  app.exit(2);
}, 60000).unref();
app
  .whenReady()
  .then(async () => {
    phase = 'creating TV window';
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
    phase = 'reading first document';
    const tv = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('https://www.youtube.com/tv'))!;
    const mainWindow = BrowserWindow.getAllWindows()[0];
    const localView = mainWindow.contentView.children.find(
      (view) =>
        'webContents' in view &&
        (view as any).webContents.getURL().startsWith('file:') &&
        !(view as any).webContents.getURL().includes('#'),
    ) as Electron.WebContentsView;
    const shell = localView.webContents;
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
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#service-error").classList.contains("warning-banner")',
      ),
      true,
    );
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

    phase = 'codec options dialog';
    await shell.executeJavaScript(
      'document.querySelector("[data-section=general]").click()',
    );
    const ui = (code: string) => shell.executeJavaScript(code);
    const waitUntil = async (
      check: () => Promise<boolean>,
      message: string,
    ) => {
      for (let i = 0; i < 200; i++) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw Error(message);
    };
    assert.equal(
      await ui('document.querySelector("#codec-vp9") === null'),
      true,
    );
    const changeMode = async (value: string) => {
      await ui(
        `document.querySelector('#codec-mode').value='${value}';document.querySelector('#codec-mode').dispatchEvent(new Event('change',{bubbles:true}))`,
      );
      await waitUntil(
        () => ui('!document.querySelector("#codec-mode").disabled'),
        'mode save',
      );
    };
    await changeMode('manual');
    const openOptions = async () => {
      await ui('document.querySelector("#codec-settings-open").click()');
      await waitUntil(
        async () =>
          mainWindow.contentView.children.some(
            (view) =>
              'webContents' in view &&
              (view as Electron.WebContentsView).webContents
                .getURL()
                .endsWith('#codec-settings') &&
              view.getVisible(),
          ) &&
          webContents
            .getAllWebContents()
            .some((c) => c.getURL().endsWith('#codec-settings')) &&
          (await webContents
            .getAllWebContents()
            .find((c) => c.getURL().endsWith('#codec-settings'))!
            .executeJavaScript(
              '!!document.querySelector("#codec-vp9") && !document.querySelector("#codec-vp9").disabled',
            )),
        'codec popup',
      );
      return webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith('#codec-settings'))!;
    };
    let popup = await openOptions();
    const popupUI = (code: string) => popup.executeJavaScript(code);
    const closeWait = () =>
      waitUntil(
        () => ui('!document.querySelector("#codec-settings-blocker").open'),
        'close popup',
      );
    assert.match(
      await popupUI('document.body.textContent'),
      /Disabling VP9 may prevent playback above 1080p/,
    );
    assert.equal(
      await popupUI('document.querySelector("#codec-force-warning") === null'),
      true,
      'the options dialog has no Force banner',
    );
    assert.deepEqual(await popupUI('[typeof window.tubevra,typeof require]'), [
      'undefined',
      'undefined',
    ]);
    const codecEvent = { sender: popup, senderFrame: popup.mainFrame };
    const channels = [
      'tubevra:options:codecs:get',
      'tubevra:options:codecs:save',
      'tubevra:options:codecs:reload',
    ];
    for (const channel of channels) {
      const handler = ipcMain._invokeHandlers.get(channel);
      assert.throws(
        () => handler({ sender: shell, senderFrame: shell.mainFrame }),
        /Untrusted/,
      );
      assert.throws(
        () => handler({ sender: tv, senderFrame: tv.mainFrame }),
        /Untrusted/,
      );
      assert.throws(
        () => handler({ sender: popup, senderFrame: { url: popup.getURL() } }),
        /Untrusted/,
      );
    }
    assert.equal(
      (await ipcMain._invokeHandlers.get(channels[0])(codecEvent, 'extra')).ok,
      false,
    );
    assert.equal(
      (
        await ipcMain._invokeHandlers.get('tubevra:extension-settings:resize')(
          codecEvent,
          -1,
        )
      ).ok,
      false,
    );
    assert.throws(
      () =>
        ipcMain._invokeHandlers.get('tubevra:extension-settings:save')(
          codecEvent,
          true,
        ),
      /Untrusted/,
    );
    assert.equal(
      (
        await ipcMain._invokeHandlers.get(channels[1])(codecEvent, {
          mode: 'manual',
          allowedCodecs: ['h264'],
        })
      ).ok,
      false,
    );
    await popupUI(
      'document.querySelector("#codec-vp9").click();document.querySelector(".ui-button--cancel").click()',
    );
    await closeWait();
    assert.equal(await ui('document.activeElement.id'), 'codec-settings-open');
    popup = await openOptions();
    assert.equal(
      await popupUI('document.querySelector("#codec-vp9").checked'),
      true,
      'cancel discards edits',
    );
    await popupUI('document.querySelector("#codec-vp9").focus()');
    assert.equal(await popupUI('document.activeElement.id'), 'codec-vp9');
    popup.focus();
    popup.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    popup.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitUntil(
      () => popupUI('!document.querySelector("#codec-vp9").checked'),
      'Space toggles the codec checkbox',
    );
    let formLoads = 0;
    const formLoaded = () => formLoads++;
    tv.on('did-finish-load', formLoaded);
    await popupUI(
      'document.querySelector("#codec-av1").click();document.querySelector(".primary").click()',
    );
    await closeWait();
    assert.equal(formLoads, 1);
    assert.deepEqual(
      (await shell.executeJavaScript('window.tubevra.getState()')).value.general
        .codecPreferences,
      { mode: 'manual', allowedCodecs: [] },
    );
    tv.removeListener('did-finish-load', formLoaded);
    popup = await openOptions();
    const generalFile = path.join(
      app.getPath('userData'),
      'general-settings.json',
    );
    fs.renameSync(generalFile, generalFile + '.backup');
    fs.mkdirSync(generalFile);
    try {
      await popupUI(
        'document.querySelector("#codec-vp9").click();document.querySelector(".primary").click()',
      );
      await waitUntil(
        () =>
          popupUI(
            '!!document.querySelector("#codec-options-feedback").textContent && !document.querySelector(".primary").disabled',
          ),
        'write error',
      );
      assert.equal(
        await popupUI('document.querySelector("#codec-vp9").checked'),
        true,
      );
    } finally {
      fs.rmdirSync(generalFile);
      fs.renameSync(generalFile + '.backup', generalFile);
    }
    const realReload = tv.reload.bind(tv);
    tv.reload = () => {
      throw Error('Popup reload failure');
    };
    await popupUI('document.querySelector(".primary").click()');
    await waitUntil(
      () =>
        popupUI(
          '!document.querySelector("#codec-options-reload").hidden && !document.querySelector("#codec-options-reload").disabled',
        ),
      'reload error',
    );
    assert.match(
      await popupUI(
        'document.querySelector("#codec-options-feedback").textContent',
      ),
      /Saved.*Popup reload failure/,
    );
    tv.reload = realReload;
    await popupUI('document.querySelector("#codec-options-reload").click()');
    await waitUntil(
      () =>
        popupUI(
          'document.querySelector("#codec-options-feedback").textContent === "Applied."',
        ),
      'retry',
    );
    popup.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    popup.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await closeWait();
    await changeMode('force');
    assert.doesNotMatch(
      await ui(
        'document.querySelector("#codec-mode").parentElement.textContent',
      ),
      /Force may prevent playback|Choose which video codecs/,
    );
    popup = await openOptions();
    assert.match(
      await popupUI('document.body.textContent'),
      /Choose which video codecs YouTube TV may use/,
    );
    assert.equal(
      await popupUI('document.querySelector("#codec-force-warning") === null'),
      true,
    );
    assert.doesNotMatch(
      await popupUI('document.body.textContent'),
      /H\.264|TV · Cobalt|Hardware acceleration not guaranteed/,
    );
    assert.equal(
      await ui(
        'document.querySelector("#service-error").classList.contains("warning-banner")',
      ),
      true,
    );
    assert.match(
      await ui('document.querySelector("#service-error").textContent'),
      /lack hardware acceleration.*stutter.*CPU/,
    );
    mainWindow.setSize(640, 680);
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    popup.focus();
    assert.equal(
      await popupUI(
        'document.querySelector(".settings-dialog").scrollWidth <= innerWidth',
      ),
      true,
    );
    await popupUI('document.querySelector(".ui-button--cancel").click()');
    await closeWait();
    await shell.executeJavaScript(
      "window.tubevra.setCodecPreferences({mode:'auto',allowedCodecs:['vp9','av1']})",
    );
    // The same native host still supports the original RYD settings, with
    // codec channels denied while the RYD document is active.
    await ui(
      'document.querySelector("[data-section=extensions]").click();document.querySelector("[data-control-id=ryd-settings]").click()',
    );
    await waitUntil(
      async () =>
        webContents
          .getAllWebContents()
          .some((c) => c.getURL().endsWith('#extension-settings')) &&
        (await webContents
          .getAllWebContents()
          .find((c) => c.getURL().endsWith('#extension-settings'))!
          .executeJavaScript(
            '!!document.querySelector("[data-control-id=ryd-show-with-dock]") && !document.querySelector("[data-control-id=ryd-show-with-dock]").disabled',
          )),
      'RYD options',
    );
    const rydOptions = webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('#extension-settings'))!;
    const rydEvent = { sender: rydOptions, senderFrame: rydOptions.mainFrame };
    assert.throws(
      () => ipcMain._invokeHandlers.get(channels[0])(rydEvent),
      /Untrusted/,
    );
    assert.equal(
      (await rydOptions.executeJavaScript('window.extensionSettings.get()')).ok,
      true,
    );
    await rydOptions.executeJavaScript(
      'document.querySelector(".primary").click()',
    );
    await waitUntil(
      () => ui('!document.querySelector("#panel-extensions dialog").open'),
      'RYD save',
    );
    await ui('document.querySelector("[data-section=general]").click()');
    popup = await openOptions();
    assert.equal(
      await popupUI('document.querySelector("#codec-vp9").checked'),
      true,
    );
    await popupUI('document.querySelector(".ui-button--cancel").click()');
    await closeWait();
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
    assert.equal(
      await shell.executeJavaScript(`(() => {
      const button = document.querySelector('#codec-settings-open');
      const mode = document.querySelector('#codec-mode');
      const resolution = document.querySelector('#playback-resolution');
      return mode.getBoundingClientRect().right <= innerWidth && button.getBoundingClientRect().right <= mode.getBoundingClientRect().left && Math.abs(mode.getBoundingClientRect().right - resolution.getBoundingClientRect().right) < 1 && !!mode.parentElement.querySelector('.row-icon svg');
    })()`),
      true,
      'codec widget controls fit the compact settings surface',
    );
    await shell.executeJavaScript(
      'window.tubevra.setPlaybackResolution("auto")',
    );
    await shell.executeJavaScript('window.tubevra.setSettingsOpen(false)');
    const initial = await read();
    phase = 'UA and codec preference transitions';
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
    // New preference API is restricted to the local shell and validates all data.
    const setCodecs = ipcMain._invokeHandlers.get(
      'tubevra:set-codec-preferences',
    );
    for (const event of [
      { sender: tv, senderFrame: tv.mainFrame },
      { sender: shell, senderFrame: tv.mainFrame },
      { sender: shell, senderFrame: { url: shell.getURL() } },
    ])
      assert.throws(
        () => setCodecs(event, { mode: 'force', allowedCodecs: [] }),
        /Untrusted/,
      );
    const trusted = { sender: shell, senderFrame: shell.mainFrame };
    for (const args of [
      [],
      [null],
      [{ mode: 'manual', allowedCodecs: ['h264'] }],
      [{ mode: 'force', allowedCodecs: [] }, 'extra'],
    ])
      assert.equal((await setCodecs(trusted, ...args)).ok, false);
    const set = (mode: string, allowedCodecs: string[]) =>
      shell.executeJavaScript(
        `window.tubevra.setCodecPreferences(${JSON.stringify({ mode, allowedCodecs })})`,
      );
    let loads = 0;
    const countLoad = () => loads++;
    tv.on('did-finish-load', countLoad);
    await set('auto', []);
    assert.equal(loads, 0, 'inactive Auto list does not reload');
    await set('manual', []);
    assert.equal(loads, 1);
    assert.equal((await read()).av1, false);
    assert.equal((await read()).vp9profile2, false);
    assert.equal((await read()).valid, false);
    await set('manual', []);
    assert.equal(loads, 1, 'identical policy does not reload');
    await set('force', ['av1']);
    assert.equal((await read()).hardwareCodecs, null);
    assert.equal((await read()).av1, true);
    assert.equal((await read()).vp9profile2, false);
    assert.equal((await read()).absurd, false);
    assert.equal((await read()).codec, false);
    assert.equal(codecProbes, 3, 'Force does not probe the GPU');
    app.emit('child-process-gone', {}, { type: 'GPU' });
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.getState()')).value
        .codecWarning,
      null,
    );
    await shell.executeJavaScript('window.tubevra.reloadTV()');
    assert.equal(codecProbes, 3, 'GPU loss and reload in Force do not probe');
    // Persistence succeeds even when applying the new document fails.
    const reload = tv.reload.bind(tv);
    tv.reload = () => {
      throw Error('Forced codec reload failure');
    };
    assert.equal((await set('manual', ['vp9'])).ok, false);
    const failed = (await shell.executeJavaScript('window.tubevra.getState()'))
      .value;
    assert.equal(failed.general.codecPreferences.mode, 'manual');
    assert.equal(failed.codecReloadRequired, true);
    assert.match(failed.error, /Forced codec reload failure/);
    tv.reload = reload;
    await shell.executeJavaScript('window.tubevra.reloadTV()');
    assert.equal(
      (await shell.executeJavaScript('window.tubevra.getState()')).value
        .codecReloadRequired,
      false,
    );
    // A non-Cobalt document retains native behavior even with a manual block list.
    await shell.executeJavaScript(
      "window.tubevra.updateUserAgents({type:'select',id:'lg_webos'})",
    );
    const before = loads;
    await set('manual', []);
    assert.equal(loads, before);
    assert.equal((await read()).hardwareCodecs, undefined);
    assert.equal((await read()).valid, true);
    await set('auto', ['vp9', 'av1']);
    await shell.executeJavaScript(
      `window.tubevra.updateUserAgents({type:'select',id:${JSON.stringify(custom)}})`,
    );
    tv.removeListener('did-finish-load', countLoad);
    // GPU loss while discovery is pending cannot publish a late ready result.
    await set('force', ['av1']);
    app.emit('child-process-gone', {}, { type: 'GPU' });
    const normalGPUInfo = app.getGPUInfo;
    let releaseGPU: ((value: any) => void) | undefined;
    let enteredProbe: () => void;
    const probing = new Promise<void>((resolve) => {
      enteredProbe = resolve;
    });
    app.getGPUInfo = () =>
      new Promise((resolve) => {
        releaseGPU = resolve;
        enteredProbe();
      });
    const pendingManual = set('manual', []);
    await probing;
    app.emit('child-process-gone', {}, { type: 'GPU' });
    assert.equal((await pendingManual).ok, true);
    assert.equal((await read()).hardwareCodecs.status, 'error');
    assert.equal(
      (await read()).av1,
      false,
      'manual blocks survive detection failure',
    );
    assert.equal((await read()).valid, false);
    releaseGPU!({});
    app.getGPUInfo = normalGPUInfo;
    const queued = await shell.executeJavaScript(`Promise.all([
      window.tubevra.setCodecPreferences({mode:'manual',allowedCodecs:['vp9']}),
      window.tubevra.setCodecPreferences({mode:'force',allowedCodecs:['av1']})
    ])`);
    assert.ok(queued.every((result: any) => result.ok));
    assert.equal((await read()).hardwareCodecs, null);
    assert.equal((await read()).av1, true);
    await set('auto', ['vp9', 'av1']);
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
      await ui(
        'document.querySelector("#service-error").classList.contains("warning-banner")',
      ),
      false,
      'actual application errors remain red',
    );
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
    mainWindow.destroy();
    assert.equal(ipcMain.listenerCount(HARDWARE_CODECS_IPC.bootstrap), 0);
    assert.equal(ipcMain.listenerCount(HARDWARE_CODECS_IPC.failure), 0);
    assert.equal(
      ipcMain._invokeHandlers.has('tubevra:set-codec-preferences'),
      false,
    );
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        passed: true,
        elapsedMs: Date.now() - started,
        checks: [
          'first page script',
          'native AV1/VP9 profile filtering and error/disabled fallback before first page script',
          'hardware codec bootstrap before first script, failure/retry and GPU invalidation',
          'runtime acceleration independent of pending preference, cached UA/resolution transitions',
          'manual and force preferences, validated IPC, one reload, failure recovery, GPU race and queued mode changes',
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
