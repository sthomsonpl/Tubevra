import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import {
  isTVDisplayParameters,
  isTVDisplayURL,
  TV_DISPLAY_IPC,
  type TVDisplayParameters,
} from '../shared/tv-display';

export function connectTVDisplay(
  ipc: IpcMain,
  contents: WebContents,
  parameters: Readonly<TVDisplayParameters>,
  reportError: (message: string) => void,
) {
  if (!isTVDisplayParameters(parameters))
    throw Error('Invalid TV display bootstrap parameters.');
  // Own the snapshot: changes to a caller's object cannot change this view.
  const snapshot = Object.freeze({ ...parameters });
  const trusted = (event: IpcMainEvent) =>
    !contents.isDestroyed() &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    isTVDisplayURL(event.senderFrame.url);
  const bootstrap = (event: IpcMainEvent, ...args: unknown[]) => {
    let result: unknown = {
      ok: false,
      error: 'Untrusted TV display bootstrap.',
    };
    try {
      if (trusted(event)) {
        result = args.length
          ? { ok: false, error: 'Unexpected TV display bootstrap arguments.' }
          : { ok: true, value: snapshot };
      }
    } catch (cause) {
      result = {
        ok: false,
        error: `TV display bootstrap failed: ${String(cause)}`,
      };
    } finally {
      // Always reply, including rejected synchronous requests.
      event.returnValue = result;
    }
  };
  const failure = (event: IpcMainEvent, ...args: unknown[]) => {
    if (
      trusted(event) &&
      args.length === 1 &&
      typeof args[0] === 'string' &&
      args[0].length > 0 &&
      args[0].length <= 1000
    )
      reportError(`TV display bootstrap failed: ${args[0]}`);
  };
  ipc.on(TV_DISPLAY_IPC.bootstrap, bootstrap);
  ipc.on(TV_DISPLAY_IPC.failure, failure);
  return {
    dispose() {
      ipc.removeListener(TV_DISPLAY_IPC.bootstrap, bootstrap);
      ipc.removeListener(TV_DISPLAY_IPC.failure, failure);
    },
  };
}
