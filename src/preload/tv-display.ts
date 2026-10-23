import { ipcRenderer } from 'electron';
import {
  isTVDisplayParameters,
  isTVDisplayURL,
  TV_DISPLAY_IPC,
  type TVDisplayParameters,
} from '../shared/tv-display';

let parameters: Readonly<TVDisplayParameters> | undefined;

export function bootstrapTVDisplay():
  | Readonly<TVDisplayParameters>
  | undefined {
  if (!process.isMainFrame || !isTVDisplayURL(location.href)) return;
  if (parameters) return parameters;
  try {
    const result = ipcRenderer.sendSync(TV_DISPLAY_IPC.bootstrap);
    if (result?.ok !== true || !isTVDisplayParameters(result.value))
      throw Error(
        typeof result?.error === 'string'
          ? result.error
          : 'Invalid TV display bootstrap response.',
      );
    parameters = Object.freeze({ ...result.value });
    return parameters;
  } catch (cause) {
    ipcRenderer.send(TV_DISPLAY_IPC.failure, String(cause).slice(0, 1000));
    throw cause;
  }
}
