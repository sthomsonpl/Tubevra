import type { ExtensionMetadata, HookExtensionStart } from '../types';

// Main receives only IDs from a build-owned manifest, never page implementations.
export function validateHookManifest(
  registry: readonly ExtensionMetadata[],
  ids: readonly string[],
) {
  const expected = registry.filter((item) => item.hooks).map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== expected.length ||
    ids.some((id) => !expected.includes(id))
  )
    throw new Error('Hook implementation manifest does not match registry.');
}

// Called in the hook package before installing anything, including disabled hooks.
export function validateHookImplementations(
  registry: readonly ExtensionMetadata[],
  starts: Readonly<Record<string, HookExtensionStart>>,
) {
  validateHookManifest(registry, Object.keys(starts));
  if (Object.values(starts).some((start) => typeof start !== 'function'))
    throw new Error('Invalid hook implementation.');
}

export function validateHookInstallation(
  value: unknown,
): asserts value is import('../types').HookCleanup {
  if (
    typeof value !== 'function' ||
    typeof (value as unknown as { then?: unknown }).then === 'function'
  )
    throw new Error('Hook installation must synchronously return cleanup.');
}
