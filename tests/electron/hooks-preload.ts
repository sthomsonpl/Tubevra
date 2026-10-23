import { executeHookEntry } from '../../src/extensions/hooks/adapter';

// Everything referenced by this function is defined inside its serialized body.
function entry(config: { offset: number }) {
  const reports: { kind: string; message: string }[] = [];
  let calls = 0;
  const target = window as unknown as {
    fixtureCall: (value: number) => number;
  };
  const original = Object.getOwnPropertyDescriptor(target, 'fixtureCall');
  const wrapper = function (value: number) {
    calls++;
    return value + config.offset;
  };
  Object.defineProperty(target, 'fixtureCall', {
    configurable: true,
    value: wrapper,
  });
  return {
    state: () => ({ calls, reports: reports.slice() }),
    report: (kind: string, message: string) => {
      if (
        (kind !== 'error' && kind !== 'reload-required') ||
        typeof message !== 'string' ||
        message.length > 200
      )
        throw Error('Invalid report');
      reports.push({ kind, message });
    },
    stop: () => {
      if (target.fixtureCall !== wrapper)
        throw Error('Hook ownership conflict');
      if (original) Object.defineProperty(target, 'fixtureCall', original);
      else delete (target as unknown as Record<string, unknown>).fixtureCall;
    },
  };
}
// Serialization must not accidentally retain preload-only bindings.
const preloadOnly = () => 123;
let closureRejected = false;
try {
  executeHookEntry(() => preloadOnly());
} catch {
  closureRejected = true;
}
if (!closureRejected) throw Error('Unexpected preload closure access');
const control = executeHookEntry(entry, [{ offset: 7 }]);
if (control.state().calls !== 0)
  throw Error('Entry did not complete synchronously');
control.report('reload-required', 'fixture reload');
control.report('error', 'fixture error');
let rejected = false;
try {
  control.report('execute', 'forbidden');
} catch {
  rejected = true;
}
if (!rejected) throw Error('Invalid control accepted');
// Private handle remains in the isolated world; the page receives no application API.
window.addEventListener('DOMContentLoaded', () => {
  const state = control.state();
  if (state.calls !== 1 || state.reports.length !== 2)
    throw Error('Control/report round trip failed');
  control.stop();
  document.documentElement.dataset.hookProof = JSON.stringify(state);
});
