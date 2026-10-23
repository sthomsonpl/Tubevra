import type { PageConfiguration } from '../types';
import type { createHookRuntime } from './runtime';
// The build plugin assembles this complete module, including all dependencies.
export function hookEntry(
  _initial: PageConfiguration,
): ReturnType<typeof createHookRuntime> {
  throw Error('Extension build plugin is required.');
}
