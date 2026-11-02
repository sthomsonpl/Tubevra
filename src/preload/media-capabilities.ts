import { ipcRenderer } from 'electron';
import {
  HARDWARE_CODECS_IPC,
  hasCobaltUserAgent,
  freezeHardwareCodecSnapshot,
  type HardwareCodecSnapshot,
} from '../shared/media-capabilities';
import { isTVDisplayURL } from '../shared/tv-display';

let snapshot: HardwareCodecSnapshot | undefined;

// Isolated-world data only. No application API or profile list is exposed to YouTube.
export function bootstrapHardwareCodecs(): HardwareCodecSnapshot | undefined {
  if (
    !process.isMainFrame ||
    !isTVDisplayURL(location.href) ||
    !hasCobaltUserAgent(navigator.userAgent)
  )
    return;
  if (snapshot) return snapshot;
  try {
    const result = ipcRenderer.sendSync(HARDWARE_CODECS_IPC.bootstrap);
    if (result?.ok !== true) throw Error('Hardware codec bootstrap rejected.');
    snapshot = freezeHardwareCodecSnapshot(result.value);
  } catch (cause) {
    const message =
      (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000) ||
      'Hardware codec bootstrap failed.';
    snapshot = freezeHardwareCodecSnapshot({ status: 'error', error: message });
    ipcRenderer.send(HARDWARE_CODECS_IPC.failure, message);
  }
  return snapshot;
}
