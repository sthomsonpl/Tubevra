import { contextBridge, ipcRenderer } from 'electron';
import { TV_DISPLAY_IPC, type TVDisplayParameters } from '../shared/tv-display';
import { bootstrapTVDisplay } from './tv-display';

// Serialized into the page's main world: keep this function self-contained.
export function overrideTVScreen({ width, height }: TVDisplayParameters) {
  // Screen dimensions are CSS pixels. Keep the native DPR and viewport so the
  // player sees the selected output resolution without applying DPI twice.
  Object.defineProperties(window.screen, {
    width: {
      configurable: true,
      enumerable: true,
      get: () => Math.round(width / window.devicePixelRatio),
    },
    height: {
      configurable: true,
      enumerable: true,
      get: () => Math.round(height / window.devicePixelRatio),
    },
  });
}

export function installTVScreen() {
  const parameters = bootstrapTVDisplay();
  if (!parameters) return;
  try {
    contextBridge.executeInMainWorld({
      func: overrideTVScreen,
      args: [parameters],
    });
  } catch (cause) {
    ipcRenderer.send(
      TV_DISPLAY_IPC.failure,
      `TV screen override failed: ${String(cause)}`.slice(0, 1000),
    );
    throw cause;
  }
}
