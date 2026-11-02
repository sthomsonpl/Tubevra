const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tubevra-codecs-smoke-'),
  );
  const resolved = path.resolve(profile);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('tubevra-codecs-smoke-')
  )
    throw Error('Invalid test profile cleanup target.');
  try {
    for (const stage of ['enabled', 'disabled']) {
      const env = {
        ...process.env,
        TUBEVRA_CODEC_TEST_PROFILE: path.join(profile, stage),
        TUBEVRA_CODEC_TEST_STAGE: stage,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [__filename], {
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 25000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(
        fs.readFileSync(path.join(profile, stage, 'result.json'), 'utf8'),
      );
      assert.equal(report.passed, true);
      console.log(JSON.stringify(report));
    }
  } finally {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.TUBEVRA_CODEC_TEST_PROFILE;
  const stage = process.env.TUBEVRA_CODEC_TEST_STAGE;
  if (!profile || !['enabled', 'disabled'].includes(stage))
    throw Error('Use isolated codec runner.');
  app.setPath('userData', profile);
  // The test has no application shell. Keep the process alive between probes.
  app.on('window-all-closed', () => {});
  if (stage === 'disabled') app.disableHardwareAcceleration();
  const ts = require('typescript');
  require.extensions['.ts'] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      filename,
    );
  const {
    createHardwareCodecDetector,
  } = require('../../src/main/media-capabilities.ts');
  const {
    isHardwareCodecSnapshot,
  } = require('../../src/shared/media-capabilities.ts');
  const watchdog = setTimeout(() => app.exit(2), 20000);
  app
    .whenReady()
    .then(async () => {
      const detector = createHardwareCodecDetector();
      const result = await detector.detect();
      assert.ok(isHardwareCodecSnapshot(result));
      assert.equal(
        result.status,
        stage === 'disabled' ? 'disabled' : 'ready',
        JSON.stringify(result),
      );
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      assert.equal(await detector.detect(), result);
      detector.invalidate();
      const fresh = await detector.detect();
      assert.equal(fresh.status, result.status, JSON.stringify(fresh));
      assert.equal(BrowserWindow.getAllWindows().length, 0);
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(
        path.join(profile, 'result.json'),
        JSON.stringify({
          passed: true,
          stage,
          electron: process.versions.electron,
          result,
        }),
      );
      clearTimeout(watchdog);
      app.exit(0);
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
