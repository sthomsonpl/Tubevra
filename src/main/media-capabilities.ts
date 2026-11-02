import { app, BrowserWindow } from 'electron';
import {
  HARDWARE_VIDEO_PROFILES,
  type HardwareCodecSnapshot,
  type HardwareVideoProfile,
} from '../shared/media-capabilities';

// Private Chromium WebUI schema. Keep this compatibility boundary isolated and
// verify it with the Electron smoke test whenever the runtime is upgraded.
// https://chromium.googlesource.com/chromium/src/+/main/content/browser/resources/gpu/browser_bridge.ts
export function parseHardwareProfiles(
  value: unknown,
): readonly HardwareVideoProfile[] {
  if (!Array.isArray(value) || value.length > 512)
    throw Error('Invalid Chromium video accelerator list.');
  let decoding = false,
    ended = false,
    decoders = 0;
  const profiles = new Set<HardwareVideoProfile>();
  for (const row of value) {
    if (
      !row ||
      typeof row.description !== 'string' ||
      typeof row.value !== 'string'
    )
      throw Error('Invalid Chromium video accelerator entry.');
    if (
      row.description === 'Decoding' &&
      row.value === '' &&
      !decoding &&
      !ended
    ) {
      decoding = true;
      continue;
    }
    if (
      row.description === 'Encoding' &&
      row.value === '' &&
      decoding &&
      !ended
    ) {
      ended = true;
      continue;
    }
    if (ended) continue; // Encoder support never implies decoder support.
    if (!decoding || !row.description.startsWith('Decode ') || !row.value)
      throw Error('Unrecognized Chromium decoder schema.');
    decoders++;
    // Profiles restricted to encrypted content do not prove clear YouTube support.
    if (
      !/^[1-9]\d*x[1-9]\d* to [1-9]\d*x[1-9]\d* pixels(?: \(encrypted\))?$/.test(
        row.value,
      )
    )
      throw Error('Unrecognized Chromium decoder capabilities.');
    if (row.value.endsWith(' (encrypted)')) continue;
    const name = row.description.slice(7);
    if ((HARDWARE_VIDEO_PROFILES as readonly string[]).includes(name))
      profiles.add(name as HardwareVideoProfile);
    else if (/^(h264|vp9|av1)\b/.test(name))
      throw Error(`Unrecognized Chromium decoder profile: ${name}`);
  }
  if (!decoding || !ended || !decoders)
    throw Error('Chromium decoder information is not ready or is empty.');
  return Object.freeze([...profiles]);
}

export function createHardwareCodecDetector() {
  let cached: HardwareCodecSnapshot | undefined;
  let pending: Promise<HardwareCodecSnapshot> | undefined;
  let revision = 0;
  let disposed = false;
  let cancelProbe: (() => void) | undefined;
  async function probe(timeoutMs: number): Promise<HardwareCodecSnapshot> {
    let window: BrowserWindow | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let cancel: () => void;
    try {
      const deadline = new Promise<never>((_, reject) => {
        cancel = () => {
          stopped = true;
          reject(Error('Hardware codec detection cancelled.'));
        };
        cancelProbe = cancel;
        timer = setTimeout(() => {
          stopped = true;
          reject(Error('Hardware codec detection timed out.'));
        }, timeoutMs);
      });
      return await Promise.race([
        deadline,
        (async (): Promise<HardwareCodecSnapshot> => {
          await app.whenReady();
          if (stopped) throw Error('Hardware codec detection cancelled.');
          if (!app.isHardwareAccelerationEnabled())
            return Object.freeze({
              status: 'disabled',
              profiles: Object.freeze([]) as readonly [],
            });
          window = new BrowserWindow({
            show: false,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true,
              partition: 'tubevra-codec-probe',
            },
          });
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          window.webContents.on('will-navigate', (event, url) => {
            if (url !== 'chrome://gpu/') event.preventDefault();
          });
          await window.loadURL('chrome://gpu');
          // Request completion; its profile object is incomplete, but the WebUI
          // receives the complete list through Chromium's own GPU update event.
          await app.getGPUInfo('complete');
          while (!stopped && !window.isDestroyed()) {
            const data = await window.webContents.executeJavaScript(`(() => {
            const info = window.browserBridge?.gpuInfo;
            return info ? { status: info.featureStatus?.featureStatus?.video_decode, rows: info.videoAcceleratorsInfo } : null;
          })()`);
            if (data?.status && /^(disabled|unavailable)/.test(data.status))
              throw Error(
                `Hardware video decoding unavailable: ${data.status}`,
              );
            if (
              data?.status === 'enabled' &&
              Array.isArray(data.rows) &&
              data.rows.some(
                (r: any) =>
                  typeof r?.description === 'string' &&
                  r.description.startsWith('Decode '),
              )
            )
              return Object.freeze({
                status: 'ready',
                profiles: parseHardwareProfiles(data.rows),
              });
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw Error('Hardware codec probe window closed.');
        })(),
      ]);
    } catch (cause) {
      return Object.freeze({
        status: 'error',
        error: (cause instanceof Error ? cause.message : String(cause)).slice(
          0,
          1000,
        ),
      });
    } finally {
      if (cancelProbe === cancel!) cancelProbe = undefined;
      stopped = true;
      clearTimeout(timer!);
      if (window && !window.isDestroyed()) window.destroy();
    }
  }
  return {
    detect(timeoutMs = 10000): Promise<HardwareCodecSnapshot> {
      if (disposed)
        return Promise.resolve({
          status: 'error',
          error: 'Hardware codec detector disposed.',
        });
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
        return Promise.reject(
          Error('Invalid hardware codec detection timeout.'),
        );
      if (cached) return Promise.resolve(cached);
      if (pending) return pending;
      const current = revision;
      const task = probe(timeoutMs)
        .then((result) => {
          if (revision === current && result.status !== 'error')
            cached = result;
          return result;
        })
        .finally(() => {
          if (pending === task) pending = undefined;
        });
      pending = task;
      return task;
    },
    invalidate() {
      revision++;
      cached = undefined;
      pending = undefined;
      cancelProbe?.();
    },
    dispose() {
      disposed = true;
      this.invalidate();
    },
  };
}
