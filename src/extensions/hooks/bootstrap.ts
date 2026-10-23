import { ipcRenderer } from 'electron';
import { executeHookEntry } from './adapter';
import { hookEntry } from './runtime';
import { PAGE_IPC } from '../page/channels';
import type { PageConfiguration } from '../types';

export function startHookRuntime() {
  const result = ipcRenderer.sendSync(PAGE_IPC.bootstrap);
  if (!result?.ok) throw Error(result?.error ?? 'Hook bootstrap failed.');
  const config = result.value as PageConfiguration;
  let control: ReturnType<typeof hookEntry>;
  try {
    control = executeHookEntry(hookEntry, [config]);
  } catch (cause) {
    ipcRenderer.send(PAGE_IPC.runtimeError, {
      document: config.document,
      error: String(cause).slice(0, 2000),
    });
    throw cause;
  }
  const problem = (cause: unknown) =>
    ipcRenderer.send(PAGE_IPC.runtimeError, {
      document: config.document,
      error: String(cause).slice(0, 2000),
    });
  const flush = () => {
    try {
      for (const report of control.drain())
        ipcRenderer.send(PAGE_IPC.hooksReport, report);
    } catch (cause) {
      problem(cause);
    }
  };
  const receive = (
    _event: Electron.IpcRendererEvent,
    next: PageConfiguration,
  ) => {
    try {
      control.apply(next);
      flush();
    } catch (cause) {
      problem(cause);
    }
  };
  ipcRenderer.on(PAGE_IPC.state, receive);
  // Diagnostics remain asynchronous; the installation above is synchronous.
  const timer = setInterval(flush, 250);
  flush();
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      ipcRenderer.removeListener(PAGE_IPC.state, receive);
      control.dispose();
    },
    { once: true },
  );
  return {
    config,
    apply: (next: PageConfiguration) => {
      control.apply(next);
      flush();
    },
  };
}
