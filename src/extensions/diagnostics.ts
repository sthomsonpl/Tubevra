import type { ExtensionDiagnostics } from './types';

// Small, data-only status maps. Extension-owned validators check their schema.
export function validDiagnostics(
  value: unknown,
): value is ExtensionDiagnostics {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 8 &&
    Object.entries(value).every(
      ([key, item]) =>
        /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) &&
        typeof item === 'string' &&
        item.length <= 100,
    )
  );
}
