import type { HookExtensionStart } from '../../../../src/extensions/types';
import { fixtureValue } from './value';
export const start: HookExtensionStart = (context) => {
  const target = window as unknown as { fixtureCall?: (n: number) => number };
  target.fixtureCall = (n) => fixtureValue(n);
  const fail = () => {
    context.requireReload('Fixture effects need reload.');
    context.reportError('Fixture hook failed.');
  };
  window.addEventListener('fixture-fail', fail);
  context.onCleanup(() => {
    window.removeEventListener('fixture-fail', fail);
    return undefined;
  });
  return () => {
    delete target.fixtureCall;
    return undefined;
  };
};
