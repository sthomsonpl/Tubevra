import { ipcRenderer } from 'electron';
import {
  HARDWARE_CODECS_IPC,
  DEFAULT_CODEC_PREFERENCES,
  hasCobaltUserAgent,
  freezeCodecBootstrapSnapshot,
  type CodecBootstrapSnapshot,
} from '../shared/media-capabilities';
import { isTVDisplayURL } from '../shared/tv-display';

let snapshot: CodecBootstrapSnapshot | undefined;

// Isolated-world data only. No application API or profile list is exposed to YouTube.
export function bootstrapHardwareCodecs(): CodecBootstrapSnapshot | undefined {
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
    snapshot = freezeCodecBootstrapSnapshot(result.value);
  } catch (cause) {
    const message =
      (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000) ||
      'Hardware codec bootstrap failed.';
    snapshot = freezeCodecBootstrapSnapshot({
      preferences: DEFAULT_CODEC_PREFERENCES,
      hardware: { status: 'error', error: message },
    });
    ipcRenderer.send(HARDWARE_CODECS_IPC.failure, message);
  }
  return snapshot;
}
