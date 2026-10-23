import type { HookExtensionStart } from '../types';
import { inspectPlayerAds } from './player';

export const start: HookExtensionStart = (context) => {
  let changed = false;
  context.wrap(JSON, 'parse', (original, receiver, args) => {
    const result: unknown = Reflect.apply(original, receiver, args);
    if (context.signal.aborted) return result;
    const plan = inspectPlayerAds(result);
    if (!plan) return result;
    if ('error' in plan) {
      context.reportError(plan.error);
      return result;
    }
    // Validate all supported fields first, then change only confirmed ad arrays.
    for (const field of plan.fields) {
      if (!Reflect.set(plan.response, field, []))
        throw Error(`Adblock: cannot clear player field ${field}.`);
      if (!changed) {
        changed = true;
        context.requireReload(
          'Adblock changed player data; reload to restore original responses.',
        );
      }
    }
    return result;
  });
  // context.wrap owns synchronous restoration and disables retained wrappers.
  return () => undefined;
};
