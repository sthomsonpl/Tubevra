import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { TubervaExtensions } from '../tuberva-extensions';
import type { PageConfiguration } from '../types';

import { PAGE_IPC } from '../page/channels';

export function connectPage(
  ipc: IpcMain,
  contents: WebContents,
  engine: TubervaExtensions,
) {
  let documentId: string | null = null;
  const trusted = (event: IpcMainInvokeEvent) => {
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
    items: engine
      .snapshot()
      .items.filter((item) => item.page)
      .map((item) => ({
        id: item.id,
        enabled: item.enabled && item.status !== 'error',
      })),
  });
  ipc.handle(PAGE_IPC.ready, (event, ...args) => {
    if (!trusted(event) || args.length)
      throw new Error('Untrusted runtime handshake.');
    documentId ??= randomUUID();
    return configuration();
  });
  ipc.handle(PAGE_IPC.report, (event, ...args) => {
    if (!trusted(event) || args.length !== 1 || !documentId) return;
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
      documentId = null;
      ipc.removeHandler(PAGE_IPC.ready);
      ipc.removeHandler(PAGE_IPC.report);
      contents.removeListener('did-start-navigation', invalidate);
    },
  };
}
