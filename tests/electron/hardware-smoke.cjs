// Load the production entry before ready, using a shared isolated profile across
// three processes to prove the saved preference reaches Electron at startup.
const {
  app,
  BrowserWindow,
  session,
  webContents,
  ipcMain,
} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = process.env.TUBEVRA_TEST_PROFILE;
const stage = process.env.TUBEVRA_TEST_ACCELERATION_STAGE;
if (!profile || !['default', 'disabled', 'enabled'].includes(stage))
  throw new Error('Use the isolated hardware acceleration test runner.');
app.setPath('userData', profile);
const output = path.resolve('out/verification/hardware');
fs.mkdirSync(output, { recursive: true });
const resultFile = path.join(output, `${stage}.json`);
fs.rmSync(resultFile, { force: true });
let disableCalls = 0;
const disable = app.disableHardwareAcceleration.bind(app);
app.disableHardwareAcceleration = () => {
  assert.equal(app.isReady(), false);
  disableCalls++;
  disable();
};
let gpuUpdated = false;
app.on('gpu-info-update', () => {
  gpuUpdated = true;
});
let restarts = 0;
let quits = 0;
// Verify the real restart handler without relaunching this test as the app.
app.relaunch = () => {
  restarts++;
};
app.quit = () => {
  quits++;
};
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, filename, error) =>
    errors.push(`${filename}: ${error.message}`),
  );
});
async function waitFor(predicate) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('Hardware acceleration test timed out.');
}

const verification = app.whenReady().then(async () => {
  session.fromPartition('persist:tubevra-tv').protocol.handle(
    'https',
    () =>
      new Response('<!doctype html><title>Local TV</title>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0]);
  const shell = win.webContents;
  await waitFor(
    async () =>
      shell.getURL() &&
      shell.executeJavaScript(
        'typeof window.tubevra !== "undefined" && !!document.querySelector("#hardware-acceleration")',
      ),
  );
  const state = async () =>
    (await shell.executeJavaScript('window.tubevra.getState()')).value;
  await waitFor(async () => !(await state()).loading);
  await waitFor(() => gpuUpdated);
  const enabled = stage !== 'disabled';
  assert.deepEqual((await state()).general, {
    hardwareAcceleration: enabled,
    restartRequired: false,
  });
  assert.equal(disableCalls, enabled ? 0 : 1);
  const gpu = app.getGPUFeatureStatus();
  const hardwareEnabled = app.isHardwareAccelerationEnabled();
  if (!enabled) {
    assert.equal(hardwareEnabled, false);
    assert.match(gpu.gpu_compositing, /disabled/);
  }
  await shell.executeJavaScript('window.tubevra.setSettingsOpen(true)');
  await shell.executeJavaScript(
    'document.querySelector("[data-section=general]").click()',
  );
  assert.equal(
    await shell.executeJavaScript(
      'document.querySelector("#hardware-acceleration").checked',
    ),
    enabled,
  );
  assert.equal(
    await shell.executeJavaScript(
      'document.querySelector("#general-restart").hidden',
    ),
    true,
  );
  const invalid = await shell.executeJavaScript(
    'window.tubevra.setHardwareAcceleration("false")',
  );
  assert.equal(invalid.ok, false);
  const restartWithoutChanges = await shell.executeJavaScript(
    'window.tubevra.restartApp()',
  );
  assert.equal(restartWithoutChanges.ok, false);
  assert.equal(restarts, 0);
  assert.equal(quits, 0);
  // Sender validation also applies to both new privileged operations.
  const tv = webContents
    .getAllWebContents()
    .find((item) => item.getURL().startsWith('https://www.youtube.com/tv'));
  for (const channel of [
    'tubevra:set-hardware-acceleration',
    'tubevra:restart-app',
  ]) {
    const handler = ipcMain._invokeHandlers.get(channel);
    assert.throws(
      () => handler({ sender: tv, senderFrame: tv.mainFrame }, false),
      /Untrusted/,
    );
  }
  if (stage !== 'enabled') {
    if (stage === 'default') {
      // Failed persistence must be visible and must restore the saved toggle.
      const file = path.join(profile, 'general-settings.json');
      fs.mkdirSync(file);
      await shell.executeJavaScript(
        'document.querySelector("#hardware-acceleration").click()',
      );
      await waitFor(() =>
        shell.executeJavaScript(
          'document.querySelector("#general-feedback").classList.contains("error") && !document.querySelector("#hardware-acceleration").disabled',
        ),
      );
      assert.equal(
        await shell.executeJavaScript(
          'document.querySelector("#hardware-acceleration").checked',
        ),
        true,
      );
      assert.equal((await state()).general.restartRequired, false);
      fs.rmdirSync(file);
    }
    await shell.executeJavaScript(
      'document.querySelector("#hardware-acceleration").click()',
    );
    await waitFor(async () => (await state()).general.restartRequired);
    await waitFor(() =>
      shell.executeJavaScript(
        '!document.querySelector("#hardware-acceleration").disabled',
      ),
    );
    assert.equal((await state()).general.hardwareAcceleration, !enabled);
    assert.equal(
      await shell.executeJavaScript(
        'document.querySelector("#general-restart").hidden',
      ),
      false,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(profile, 'general-settings.json'), 'utf8'),
      ).hardwareAcceleration,
      !enabled,
    );
    if (stage === 'default') {
      // Reverting to the running preference removes the restart notice.
      await shell.executeJavaScript(
        'document.querySelector("#hardware-acceleration").click()',
      );
      await waitFor(async () => !(await state()).general.restartRequired);
      await waitFor(() =>
        shell.executeJavaScript(
          '!document.querySelector("#hardware-acceleration").disabled',
        ),
      );
      await shell.executeJavaScript(
        'document.querySelector("#hardware-acceleration").click()',
      );
      await waitFor(async () => (await state()).general.restartRequired);
      await waitFor(() =>
        shell.executeJavaScript(
          '!document.querySelector("#hardware-acceleration").disabled',
        ),
      );
      for (const [width, height] of [
        [1280, 800],
        [640, 680],
      ]) {
        win.setSize(width, height);
        win.show();
        win.focus();
        await waitFor(() =>
          shell.executeJavaScript(
            'document.querySelector("#settings-title").textContent === "General"',
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 700));
        const layout = await shell.executeJavaScript(`(() => {
          const panel = document.querySelector('#panel-general').getBoundingClientRect();
          const restart = document.querySelector('#general-restart').getBoundingClientRect();
          const reload = document.querySelector('#reload-home').getBoundingClientRect();
          return {
            bottomGap: Math.abs(panel.bottom - restart.bottom),
            afterReload: restart.top >= reload.bottom,
            iconColor: getComputedStyle(document.querySelector('#general-restart .row-icon')).color,
          };
        })()`);
        assert.ok(
          layout.bottomGap < 1,
          'restart notice stays at the bottom of General',
        );
        assert.equal(layout.afterReload, true);
        assert.equal(layout.iconColor, 'rgb(250, 204, 21)');
        assert.equal(
          await shell.executeJavaScript(
            'document.documentElement.scrollWidth > innerWidth',
          ),
          false,
        );
        fs.writeFileSync(
          path.join(output, `general-${width}.png`),
          (await shell.capturePage()).toPNG(),
        );
      }
    }
    await shell.executeJavaScript(
      'document.querySelector("#restart-app").click()',
    );
    await waitFor(() => restarts === 1 && quits === 1);
  }
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    stage,
    disableCalls,
    hardwareEnabled,
    gpu,
    restarts,
    quits,
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(0);
});
assert.equal(app.isReady(), false);
require(
  path.join(
    process.env.TUBEVRA_TEST_PACKAGE ?? path.resolve('out/Tubevra-win32-x64'),
    'resources/app.asar/.vite/build/main.cjs',
  ),
);
verification.catch((error) => {
  console.error(error);
  fs.writeFileSync(
    resultFile,
    JSON.stringify({ passed: false, error: String(error) }),
  );
  app.exit(1);
});
