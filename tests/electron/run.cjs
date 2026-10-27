const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const task = process.argv[2];
if (
  ![
    'adblock-smoke',
    'ui-smoke',
    'hardware-smoke',
    'glass-probe',
    'dock-smoke',
    'live-smoke',
    'runtime-smoke',
    'hooks-smoke',
    'hooks-bootstrap-smoke',
  ].includes(task)
)
  throw new Error('Choose a Tubevra Electron test.');
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), 'tubevra-electron-test-'),
);
const resolved = path.resolve(profile);
if (
  path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
  !path.basename(resolved).startsWith('tubevra-electron-test-')
) {
  throw new Error(
    'Refusing to use a directory outside the test temporary root.',
  );
}
const env = { ...process.env, TUBEVRA_TEST_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_TLS_REJECT_UNAUTHORIZED;
const adblockResult = path.resolve('out/verification/adblock/result.json');
if (task === 'adblock-smoke') fs.rmSync(adblockResult, { force: true });
try {
  if (task === 'hardware-smoke') {
    for (const stage of ['default', 'disabled', 'enabled']) {
      const reportFile = path.resolve(
        `out/verification/hardware/${stage}.json`,
      );
      fs.rmSync(reportFile, { force: true });
      const result = spawnSync(
        require('electron'),
        [path.join(__dirname, 'hardware-smoke.cjs')],
        {
          env: { ...env, TUBEVRA_TEST_ACCELERATION_STAGE: stage },
          stdio: 'inherit',
          timeout: 60000,
        },
      );
      if (result.error) throw result.error;
      if (!fs.existsSync(reportFile))
        throw new Error(
          `Hardware acceleration stage produced no result: ${stage} (exit ${result.status}).`,
        );
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (result.status !== 0 || report.passed !== true)
        throw new Error(`Hardware acceleration stage failed: ${stage}`);
    }
  } else {
    const result = spawnSync(
      require('electron'),
      [path.join(__dirname, `${task}.cjs`)],
      { env, stdio: 'inherit', timeout: 90000 },
    );
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status ?? 1;
    if (task === 'adblock-smoke') {
      if (!fs.existsSync(adblockResult))
        throw new Error('Adblock Electron test did not produce a result.');
      const report = JSON.parse(fs.readFileSync(adblockResult, 'utf8'));
      if (report.passed !== true)
        throw new Error('Adblock Electron test failed: ' + report.error);
    }
  }
} finally {
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
