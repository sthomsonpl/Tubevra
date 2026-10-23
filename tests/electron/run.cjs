const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const task = process.argv[2];
if (!['ui-smoke', 'glass-probe', 'live-smoke', 'runtime-smoke'].includes(task))
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
try {
  const result = spawnSync(
    require('electron'),
    [path.join(__dirname, `${task}.cjs`)],
    { env, stdio: 'inherit', timeout: 90000 },
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
