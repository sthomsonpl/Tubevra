import { contextBridge } from 'electron';
import { bootstrapTVDisplay } from './tv-display';
import { isTVDisplayURL } from '../shared/tv-display';

export function hasCobaltUserAgent(value: string): boolean {
  return /(?:^|[\s;(])Cobalt\/\d[^\s;)]*/i.test(value);
}

/** Compatibility policy, not a measurement of decoder throughput. Physical pixels. */
export function cobaltMediaLimits(display: { width: number; height: number }) {
  return {
    width: display.width,
    height: display.height,
    framerate: 60,
    bitrate: 300_000_000,
    channels: 8,
  };
}

// Serialized into the main world. Keep all runtime dependencies inside this entry.
export function overrideCobaltMediaCapabilities(limits: {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  channels: number;
}) {
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw Error('Invalid Cobalt media limits.');
  const marker = Symbol.for('tubevra.cobaltMediaCapabilities');
  const original = MediaSource.isTypeSupported;
  if (Reflect.get(MediaSource, marker) === original) return;
  const owned = new Set([
    'width',
    'height',
    'framerate',
    'bitrate',
    'channels',
    'eotf',
    'cryptoblockformat',
    'decode-to-texture',
  ]);
  const numeric = (value: string, maximum: number, integer: boolean) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
    const number = Number(value);
    return (
      Number.isFinite(number) &&
      number > 0 &&
      number <= maximum &&
      (!integer || Number.isSafeInteger(number))
    );
  };
  const validate = (key: string, value: string) => {
    switch (key) {
      case 'width':
      case 'height':
      case 'channels':
        return numeric(value, limits[key], true);
      case 'framerate':
      case 'bitrate':
        return numeric(value, limits[key], false);
      case 'eotf':
        return (
          value === 'bt709' ||
          ((value === 'smpte2084' || value === 'arib-std-b67') &&
            window.matchMedia('(dynamic-range: high)').matches)
        );
      case 'cryptoblockformat':
        return value === 'subsample';
      case 'decode-to-texture':
        return value === 'true' || value === 'false';
      default:
        return false;
    }
  };
  const wrapped = new Proxy(original, {
    apply(target, receiver, args) {
      if (!args.length) return Reflect.apply(target, receiver, args);
      // Template conversion preserves WebIDL's rejection of Symbols.
      const type = `${args[0]}`;
      const pieces: string[] = [];
      let start = 0,
        quoted = false,
        escaped = false;
      for (let index = 0; index < type.length; index++) {
        const char = type[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quoted && char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') quoted = !quoted;
        if (char === ';' && !quoted) {
          pieces.push(type.slice(start, index));
          start = index + 1;
        }
      }
      pieces.push(type.slice(start));
      if (quoted || escaped) return false;
      const kept = [pieces[0]];
      const seen = new Set<string>();
      let modified = false;
      for (const piece of pieces.slice(1)) {
        const match = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(piece);
        const key = (match?.[1] ?? piece.trim()).toLowerCase();
        if (!owned.has(key)) {
          kept.push(piece);
          continue;
        }
        if (!match || seen.has(key)) return false;
        seen.add(key);
        let value = match[2];
        if (value.startsWith('"')) {
          if (!/^"[^"\\]*"$/.test(value)) return false;
          value = value.slice(1, -1);
        }
        if (!validate(key, value)) return false;
        modified = true;
      }
      return Reflect.apply(target, receiver, [
        modified ? kept.join(';') : type,
      ]);
    },
  });
  Object.defineProperty(MediaSource, 'isTypeSupported', {
    ...Object.getOwnPropertyDescriptor(MediaSource, 'isTypeSupported'),
    value: wrapped,
  });
  Object.defineProperty(MediaSource, marker, {
    value: wrapped,
    configurable: true,
  });
}

export function installCobaltMediaCapabilities() {
  if (
    !process.isMainFrame ||
    !isTVDisplayURL(location.href) ||
    !hasCobaltUserAgent(navigator.userAgent)
  )
    return;
  const display = bootstrapTVDisplay();
  if (!display)
    throw Error('Cobalt media capabilities: missing display parameters.');
  contextBridge.executeInMainWorld({
    func: overrideCobaltMediaCapabilities,
    args: [cobaltMediaLimits(display)],
  });
}
