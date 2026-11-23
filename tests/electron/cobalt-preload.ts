import '../../src/preload/tv-preload';
import { contextBridge } from 'electron';
import { bootstrapHardwareCodecs } from '../../src/preload/media-capabilities';

// Test-only observation of data that production keeps in the isolated preload.
contextBridge.executeInMainWorld({
  func: (snapshot: unknown) => {
    (window as any).__testCodecPolicy = snapshot;
    (window as any).__testCodecBootstrap = (snapshot as any)?.hardware;
  },
  args: [bootstrapHardwareCodecs()],
});
