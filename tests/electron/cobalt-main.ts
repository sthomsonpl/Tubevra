import { app, BrowserWindow, session, webContents } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  overrideCobaltMediaCapabilities,
  cobaltMediaLimits,
} from '../../src/preload/cobalt-media-capabilities';
import { createTVWindow } from '../../src/main/tv-window';
import { UserAgentStore } from '../../src/main/user-agent-store';
if (!process.env.TUBEVRA_TEST_PROFILE) throw Error('Use isolated runner');
app.setPath('userData', process.env.TUBEVRA_TEST_PROFILE);
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
 window.firstResults={ua:navigator.userAgent,absurd:MediaSource.isTypeSupported('video/webm;codecs="vp9";framerate=9999'),valid:MediaSource.isTypeSupported('video/webm;codecs="vp9";framerate=59.94'),codec:MediaSource.isTypeSupported('video/webm;codecs="nonexistent";width=640'),node:typeof require};
 </script><h1>Local Cobalt compatibility fixture</h1>${request.url.endsWith('/frame') ? '' : '<iframe src="https://www.youtube.com/tv/frame"></iframe>'}`,
          { headers: { 'Content-Type': 'text/html' } },
        ),
    );
    await createTVWindow(await UserAgentStore.open(app.getPath('userData')));
    const tv = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith('https://www.youtube.com/tv'))!;
    const shell = BrowserWindow.getAllWindows()[0].webContents;
    const read = () => tv.executeJavaScript('window.firstResults');
    const initial = await read();
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
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        passed: true,
        elapsedMs: Date.now() - started,
        checks: [
          'first page script',
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
