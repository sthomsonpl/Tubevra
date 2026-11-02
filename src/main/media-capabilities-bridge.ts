import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import {
  HARDWARE_CODECS_IPC,
  freezeHardwareCodecSnapshot,
  type HardwareCodecSnapshot,
} from '../shared/media-capabilities';
import { isTVDisplayURL } from '../shared/tv-display';

export function connectHardwareCodecs(
  ipc: IpcMain,
  contents: WebContents,
  reportWarning: (message: string) => void,
) {
  let snapshot: HardwareCodecSnapshot | undefined;
  let disposed = false;
  const trusted = (event: IpcMainEvent) =>
    !disposed &&
    !contents.isDestroyed() &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    isTVDisplayURL(event.senderFrame.url) &&
    // The main process prepares snapshots only for a Cobalt document.
    snapshot !== undefined;
  const bootstrap = (event: IpcMainEvent, ...args: unknown[]) => {
    let result: unknown = {
      ok: false,
      error: 'Untrusted or unprepared hardware codec bootstrap.',
    };
    try {
      if (trusted(event))
        result = args.length
          ? {
              ok: false,
              error: 'Unexpected hardware codec bootstrap arguments.',
            }
          : { ok: true, value: snapshot };
    } catch {
      result = { ok: false, error: 'Hardware codec bootstrap failed.' };
    } finally {
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
      reportWarning(`Hardware codec filtering unavailable: ${args[0]}`);
  };
  ipc.on(HARDWARE_CODECS_IPC.bootstrap, bootstrap);
  ipc.on(HARDWARE_CODECS_IPC.failure, failure);
  return {
    update(value: HardwareCodecSnapshot | undefined) {
      if (!disposed)
        snapshot =
          value === undefined ? undefined : freezeHardwareCodecSnapshot(value);
    },
    dispose() {
      disposed = true;
      snapshot = undefined;
      ipc.removeListener(HARDWARE_CODECS_IPC.bootstrap, bootstrap);
      ipc.removeListener(HARDWARE_CODECS_IPC.failure, failure);
    },
  };
}
