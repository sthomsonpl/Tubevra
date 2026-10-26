const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const ts = require('typescript');

// Compile only these source modules with the existing TypeScript dependency;
// no additional test runner or production loader is needed.
require.extensions['.ts'] = (module, filename) => {
  const source = require('node:fs').readFileSync(filename, 'utf8');
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
};
const { UserAgentStore } = require('../src/main/user-agent-store.ts');
const {
  GeneralSettingsStore,
} = require('../src/main/general-settings-store.ts');
const { USER_AGENT_PRESETS } = require('../src/config/user-agents.ts');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tubevra-core-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('tubevra-core-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return {
    directory,
    file: path.join(directory, 'user-agents.json'),
    store: await UserAgentStore.open(directory),
  };
}

test('first launch saves a stable selection, without copying built-ins to user data', async (t) => {
  const { store, file } = await fixture(t);
  assert.equal(store.snapshot().activeId, 'ps4');
  assert.equal(store.activeUserAgent(), USER_AGENT_PRESETS.ps4);
  assert.equal(store.snapshot().presets.length, 7);
  assert.ok(Object.isFrozen(USER_AGENT_PRESETS));
  const snapshot = store.snapshot();
  snapshot.presets[0].userAgent = 'tampered';
  assert.equal(store.activeUserAgent(), USER_AGENT_PRESETS.ps4);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
    version: 1,
    activeId: 'ps4',
    custom: [],
  });
});

test('custom CRUD, active edits, explicit replacement and restart preserve exact UA values', async (t) => {
  const { store, directory } = await fixture(t);
  const value = 'My exact UA/1.0;  compatible; ';
  const added = await store.update({
    type: 'add',
    name: 'My TV',
    userAgent: value,
  });
  const custom = added.presets.find((entry) => !entry.builtIn);
  await store.update({ type: 'select', id: custom.id });
  let reopened = await UserAgentStore.open(directory);
  assert.equal(reopened.activeUserAgent(), value);
  await reopened.update({
    type: 'edit',
    id: custom.id,
    name: 'Renamed',
    userAgent: `${value}v2`,
  });
  reopened = await UserAgentStore.open(directory);
  assert.equal(reopened.activeUserAgent(), `${value}v2`);
  await assert.rejects(
    reopened.update({ type: 'remove', id: custom.id }),
    /replacement/,
  );
  await assert.rejects(
    reopened.update({
      type: 'remove',
      id: custom.id,
      replacementId: custom.id,
    }),
    /replacement/,
  );
  await reopened.update({
    type: 'remove',
    id: custom.id,
    replacementId: 'tizen',
  });
  reopened = await UserAgentStore.open(directory);
  assert.equal(reopened.snapshot().activeId, 'tizen');
  assert.equal(reopened.snapshot().presets.length, 7);
});

test('built-ins cannot be edited/deleted; malformed requests do not change memory or disk', async (t) => {
  const { store, file } = await fixture(t);
  const before = await fs.readFile(file, 'utf8');
  for (const input of [
    { type: 'edit', id: 'ps4', name: 'Changed', userAgent: 'Changed' },
    { type: 'remove', id: 'ps4', replacementId: 'cobalt' },
    { type: 'select', id: 'toString' },
    { type: 'select', id: '__proto__' },
    { type: 'select', id: 'cobalt', extra: true },
    { type: 'add', name: 'Invalid', userAgent: 'UA\r\nInjected: true' },
    { type: 'add', name: '', userAgent: 'Valid' },
    { type: 'add', name: 'Invalid', userAgent: 'x'.repeat(4097) },
    null,
    [],
  ])
    await assert.rejects(store.update(input));
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal(store.activeUserAgent(), USER_AGENT_PRESETS.ps4);
  await store.update({ type: 'select', id: 'cobalt' });
  assert.equal(store.activeUserAgent(), USER_AGENT_PRESETS.cobalt);
});

test('corrupted/unknown settings are rejected without overwriting the original file', async (t) => {
  const { directory, file } = await fixture(t);
  for (const content of [
    '{broken',
    JSON.stringify({ version: 2, activeId: 'ps4', custom: [] }),
    JSON.stringify({ version: 1, activeId: 'missing', custom: [] }),
    JSON.stringify({
      version: 1,
      activeId: 'ps4',
      custom: [{ id: 'ps4', name: 'Override', userAgent: 'UA' }],
    }),
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(UserAgentStore.open(directory), /preserved/);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
});

test('concurrent changes are serialized and survive reopening', async (t) => {
  const { directory, store } = await fixture(t);
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      store.update({
        type: 'add',
        name: `TV ${index}`,
        userAgent: `UA/${index}`,
      }),
    ),
  );
  const reopened = await UserAgentStore.open(directory);
  const custom = reopened.snapshot().presets.filter((entry) => !entry.builtIn);
  assert.equal(custom.length, 8);
  assert.equal(new Set(custom.map((entry) => entry.id)).size, 8);
});

test('a failed atomic replacement leaves the last committed selection intact and the queue recovers', async (t) => {
  const { directory, store, file } = await fixture(t);
  const backup = path.join(directory, 'backup.json');
  await fs.rename(file, backup);
  await fs.mkdir(file);
  await assert.rejects(store.update({ type: 'select', id: 'cobalt' }));
  assert.equal(store.snapshot().activeId, 'ps4');
  assert.equal(JSON.parse(await fs.readFile(backup, 'utf8')).activeId, 'ps4');
  assert.deepEqual((await fs.readdir(directory)).sort(), [
    'backup.json',
    'user-agents.json',
  ]);
  await fs.rmdir(file);
  await fs.rename(backup, file);
  await store.update({ type: 'select', id: 'tizen' });
  assert.equal(
    (await UserAgentStore.open(directory)).snapshot().activeId,
    'tizen',
  );
});

test('hardware acceleration defaults on, persists across restarts and clears a reverted restart requirement', async (t) => {
  const { directory } = await fixture(t);
  const store = GeneralSettingsStore.open(directory);
  assert.deepEqual(store.snapshot(), {
    hardwareAcceleration: true,
    restartRequired: false,
  });
  await store.setHardwareAcceleration(false);
  assert.deepEqual(store.snapshot(), {
    hardwareAcceleration: false,
    restartRequired: true,
  });
  const reopened = GeneralSettingsStore.open(directory);
  assert.deepEqual(reopened.snapshot(), {
    hardwareAcceleration: false,
    restartRequired: false,
  });
  await store.setHardwareAcceleration(true);
  assert.equal(store.snapshot().restartRequired, false);
  await reopened.setHardwareAcceleration(true);
  assert.equal(reopened.snapshot().restartRequired, true);
  assert.deepEqual(GeneralSettingsStore.open(directory).snapshot(), {
    hardwareAcceleration: true,
    restartRequired: false,
  });
});

test('invalid hardware acceleration requests preserve settings and later writes still succeed', async (t) => {
  const { directory } = await fixture(t);
  const store = GeneralSettingsStore.open(directory);
  await store.setHardwareAcceleration(false);
  const file = path.join(directory, 'general-settings.json');
  const saved = await fs.readFile(file, 'utf8');
  for (const invalid of [null, undefined, 'false', 0, {}, []])
    await assert.rejects(store.setHardwareAcceleration(invalid), /flag/);
  assert.equal(await fs.readFile(file, 'utf8'), saved);
  assert.equal(store.snapshot().hardwareAcceleration, false);
  await Promise.all([
    store.setHardwareAcceleration(true),
    store.setHardwareAcceleration(false),
    store.setHardwareAcceleration(true),
  ]);
  assert.equal(
    GeneralSettingsStore.open(directory).snapshot().hardwareAcceleration,
    true,
  );
});

test('invalid general configuration is reported and preserved', async (t) => {
  const { directory } = await fixture(t);
  const file = path.join(directory, 'general-settings.json');
  for (const content of [
    '{broken',
    'null',
    '[]',
    JSON.stringify({ version: 2, hardwareAcceleration: false }),
    JSON.stringify({ version: 1, hardwareAcceleration: 'false' }),
    JSON.stringify({ version: 1, hardwareAcceleration: false, extra: true }),
    ' '.repeat(4097),
  ]) {
    await fs.writeFile(file, content);
    assert.throws(() => GeneralSettingsStore.open(directory), /preserved/);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
});

test('a failed general settings write preserves the running preference and recovers', async (t) => {
  const { directory } = await fixture(t);
  const store = GeneralSettingsStore.open(directory);
  const file = path.join(directory, 'general-settings.json');
  await fs.mkdir(file);
  await assert.rejects(store.setHardwareAcceleration(false));
  assert.deepEqual(store.snapshot(), {
    hardwareAcceleration: true,
    restartRequired: false,
  });
  assert.deepEqual((await fs.readdir(directory)).sort(), [
    'general-settings.json',
    'user-agents.json',
  ]);
  await fs.rmdir(file);
  await store.setHardwareAcceleration(false);
  assert.equal(
    GeneralSettingsStore.open(directory).snapshot().hardwareAcceleration,
    false,
  );
});
