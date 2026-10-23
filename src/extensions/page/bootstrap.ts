import { ipcRenderer } from 'electron';
import { PageRuntime } from './runtime';
import { PAGE_IPC } from './channels';
import { startHookRuntime } from '../hooks/bootstrap';
import type { PageConfiguration, PageExtensionStart } from '../types';
export function startPageRuntime(
  starts: Readonly<Record<string, PageExtensionStart>> = {},
) {
  if (
    process.isMainFrame &&
    location.origin === 'https://www.youtube.com' &&
    (location.pathname === '/tv' || location.pathname.startsWith('/tv/'))
  ) {
    const problem = (cause: unknown) => {
      console.error('Extension runtime failed:', cause);
      if (bootstrap)
        ipcRenderer.send(PAGE_IPC.runtimeError, {
          document: bootstrap.config.document,
          error: String(cause).slice(0, 2000),
        });
    };
    let bootstrap: ReturnType<typeof startHookRuntime>;
    try {
      bootstrap = startHookRuntime();
    } catch (cause) {
      problem(cause);
      return;
    }
    let runtime: PageRuntime | undefined;
    let closed = false;
    let latest: PageConfiguration | undefined;
    const receive = (
      _event: Electron.IpcRendererEvent,
      config: PageConfiguration,
    ) => {
      if (
        config.document !== bootstrap.config.document ||
        !Number.isSafeInteger(config.revision) ||
        config.revision <= (latest?.revision ?? bootstrap.config.revision)
      )
        return;
      latest = config;
      if (!closed && runtime) void runtime.apply(config);
    };
    ipcRenderer.on(PAGE_IPC.state, receive);
    window.addEventListener(
      'pagehide',
      () => {
        closed = true;
        ipcRenderer.removeListener(PAGE_IPC.state, receive);
        void runtime?.dispose();
      },
      { once: true },
    );
    void ipcRenderer
      .invoke(PAGE_IPC.ready)
      .then((config: PageConfiguration) => {
        if (closed) return;
        if (config.document !== bootstrap.config.document)
          throw Error('Runtime document changed during bootstrap.');
        bootstrap.apply(
          latest && latest.revision > config.revision ? latest : config,
        );
        runtime = new PageRuntime(
          config.document,
          document,
          starts,
          (report) => {
            void ipcRenderer
              .invoke(PAGE_IPC.report, report)
              .catch((cause) =>
                console.error('Extension report failed:', cause),
              );
          },
        );
        return runtime.apply(
          latest && latest.revision > config.revision ? latest : config,
        );
      })
      .catch(problem);
  }
}
