import type { HookExtensionStart } from '../types';
import { inspectPlayerAds } from './player';
import { inspectFeedAds } from './feed';

export const start: HookExtensionStart = (context) => {
  let changed = false;
  context.wrap(JSON, 'parse', (original, receiver, args) => {
    const result: unknown = Reflect.apply(original, receiver, args);
    if (context.signal.aborted) return result;
    const plan = inspectPlayerAds(result);
    const feed = inspectFeedAds(result);
    const error =
      plan && 'error' in plan
        ? plan.error
        : 'error' in feed
          ? feed.error
          : undefined;
    if (error) {
      context.reportError(error);
      return result;
    }
    // Validate both response types before applying any changes.
    if (plan && 'fields' in plan)
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
    for (const change of 'changes' in feed ? feed.changes : []) {
      if (!Reflect.set(change.owner, change.field, change.items))
        throw Error(`Adblock: cannot filter feed field ${change.path}.`);
      if (!changed) {
        changed = true;
        context.requireReload(
          'Adblock changed feed data; reload to restore original responses.',
        );
      }
    }
    return result;
  });
  // context.wrap owns synchronous restoration and disables retained wrappers.
  return () => undefined;
};
