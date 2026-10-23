import { randomUUID } from 'node:crypto';
import type {
  IpcMain,
  IpcMainInvokeEvent,
  IpcMainEvent,
  WebContents,
} from 'electron';
import type { TubervaExtensions } from '../tuberva-extensions';
import type { PageConfiguration } from '../types';

import { PAGE_IPC } from '../page/channels';

export function connectPage(
  ipc: IpcMain,
  contents: WebContents,
  engine: TubervaExtensions,
) {
  let documentId: string | null = null;
  let windowStart = 0;
  let messages = 0;
  const allowedReport = () => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      messages = 0;
    }
    return ++messages <= 400;
  };
  const watchdog = setInterval(() => {
    const state = engine.snapshot();
    for (const item of state.items) {
      const key = `${state.revision}:${item.id}`;
      if (item.status !== 'starting') {
        waiting.delete(key);
        continue;
      }
      const since = waiting.get(key) ?? Date.now();
      waiting.set(key, since);
      if (Date.now() - since >= 10000 && documentId) {
        const layer =
          item.hooks && item.layers?.hooks === 'starting' ? 'hooks' : 'page';
        const report = {
          document: documentId,
          revision: state.revision,
          id: item.id,
          instance: '',
          layer,
          status: 'error',
          error: 'Runtime confirmation timed out.',
          reloadReason: 'Runtime did not confirm startup.',
        };
        if (layer === 'hooks') void engine.reportHook(report);
        else void engine.reportPage(report);
        waiting.delete(key);
      }
    }
    for (const key of waiting.keys())
      if (!key.startsWith(`${state.revision}:`)) waiting.delete(key);
  }, 1000);
  watchdog.unref();
  const waiting = new Map<string, number>();
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    if (
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      return false;
    try {
      const url = new URL(event.senderFrame.url);
      return (
        url.origin === 'https://www.youtube.com' &&
        (url.pathname === '/tv' || url.pathname.startsWith('/tv/'))
      );
    } catch {
      return false;
    }
  };
  const configuration = (): PageConfiguration => ({
    document: documentId!,
    revision: engine.snapshot().revision,
    hooks: engine
      .snapshot()
      .items.filter((item) => item.hooks)
      .map((item) => ({
        id: item.id,
        enabled:
          item.enabled && item.modes.includes('tv') && item.status !== 'error',
      })),
    items: engine
      .snapshot()
      .items.filter((item) => item.page)
      .map((item) => ({
        id: item.id,
        enabled:
          item.enabled && item.modes.includes('tv') && item.status !== 'error',
      })),
  });
  const bootstrap = (event: IpcMainEvent, ...args: unknown[]) => {
    let result: unknown = { ok: false, error: 'Untrusted hook bootstrap.' };
    try {
      if (!trusted(event) || args.length) return;
      documentId ??= randomUUID();
      result = { ok: true, value: configuration() };
    } catch (cause) {
      result = { ok: false, error: String(cause) };
    } finally {
      event.returnValue = result;
    }
  };
  const hooksReport = (event: IpcMainEvent, ...args: unknown[]) => {
    if (!trusted(event) || args.length !== 1 || !documentId || !allowedReport())
      return;
    const value = args[0];
    if (
      !value ||
      typeof value !== 'object' ||
      (value as { document?: unknown }).document !== documentId
    )
      return;
    void engine.reportHook(value);
  };
  const runtimeError = (event: IpcMainEvent, ...args: unknown[]) => {
    if (!trusted(event) || args.length !== 1 || !allowedReport()) return;
    const value = args[0] as { document?: unknown; error?: unknown } | null;
    if (
      documentId &&
      value?.document === documentId &&
      typeof value.error === 'string' &&
      value.error.length <= 2000
    )
      void engine.failRuntime(value.error);
  };
  ipc.on(PAGE_IPC.runtimeError, runtimeError);
  ipc.on(PAGE_IPC.bootstrap, bootstrap);
  ipc.on(PAGE_IPC.hooksReport, hooksReport);
  ipc.handle(PAGE_IPC.ready, (event, ...args) => {
    if (!trusted(event) || args.length)
      throw new Error('Untrusted runtime handshake.');
    documentId ??= randomUUID();
    return configuration();
  });
  ipc.handle(PAGE_IPC.report, (event, ...args) => {
    if (!trusted(event) || args.length !== 1 || !documentId || !allowedReport())
      return;
    const value = args[0];
    if (!value || typeof value !== 'object' || value.document !== documentId)
      return;
    return engine.reportPage(value);
  });
  const invalidate = (
    _event: unknown,
    _url: string,
    inPlace: boolean,
    mainFrame: boolean,
  ) => {
    if (mainFrame && !inPlace) {
      documentId = null;
      engine.resetPage();
    }
  };
  contents.on('did-start-navigation', invalidate);
  return {
    publish() {
      if (documentId && !contents.isDestroyed())
        contents.send(PAGE_IPC.state, configuration());
    },
    dispose() {
      clearInterval(watchdog);
      waiting.clear();
      documentId = null;
      ipc.removeListener(PAGE_IPC.runtimeError, runtimeError);
      ipc.removeListener(PAGE_IPC.bootstrap, bootstrap);
      ipc.removeListener(PAGE_IPC.hooksReport, hooksReport);
      ipc.removeHandler(PAGE_IPC.ready);
      ipc.removeHandler(PAGE_IPC.report);
      contents.removeListener('did-start-navigation', invalidate);
    },
  };
}
