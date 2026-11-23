import { contextBridge, ipcRenderer } from 'electron';
import { bootstrapTVDisplay } from './tv-display';
import { bootstrapHardwareCodecs } from './media-capabilities';
import { isTVDisplayURL } from '../shared/tv-display';
import {
  hasCobaltUserAgent,
  HARDWARE_CODECS_IPC,
  type HardwareVideoProfile,
  type CodecPreferences,
} from '../shared/media-capabilities';
export { hasCobaltUserAgent } from '../shared/media-capabilities';

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
export function overrideCobaltMediaCapabilities(
  limits: {
    width: number;
    height: number;
    framerate: number;
    bitrate: number;
    channels: number;
  },
  hardwareProfiles: readonly HardwareVideoProfile[] | null = null,
  preferences: CodecPreferences = {
    mode: 'auto',
    allowedCodecs: ['vp9', 'av1'],
  },
) {
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw Error('Invalid Cobalt media limits.');
  const marker = Symbol.for('tubevra.cobaltMediaCapabilities');
  const original = MediaSource.isTypeSupported;
  if (Reflect.get(MediaSource, marker) === original) return;
  const hardware =
    hardwareProfiles === null || preferences.mode === 'force'
      ? null
      : new Set(hardwareProfiles);
  let warning: string | null = null;
  const unknownProfile = () => {
    warning ??=
      'Unrecognized video codec profile; native codec support is used for that query.';
  };
  // Map profile identity only; Chromium remains responsible for levels, bit
  // depth, color parameters and container validity. No throughput is inferred.
  // Chromium mime_util_internal.cc resolves legacy VP9 to profile 0 and bare AVC to baseline.
  const profileFor = (codec: string): string | undefined => {
    if (codec === 'vp9' || codec === 'vp9.0') return 'vp9 profile0';
    const vp9 = /^vp09\.0([0-3])\.\d{2}\.\d{2}(?:\.\d{2})*$/.exec(codec);
    if (vp9) return `vp9 profile${vp9[1]}`;
    const av1 = /^av01\.([012])\.\d{2}[MH]\.\d{2}(?:\.\d+)*$/.exec(codec);
    if (av1)
      return ['av1 profile main', 'av1 profile high', 'av1 profile pro'][
        Number(av1[1])
      ];
    if (codec === 'avc1' || codec === 'avc3') return 'h264 baseline';
    const avc = /^avc[13]\.([\da-f]{2})[\da-f]{4}$/i.exec(codec);
    if (avc) {
      const profiles: Record<string, string> = {
        '42': 'h264 baseline',
        '4d': 'h264 main',
        '58': 'h264 extended',
        '64': 'h264 high',
        '6e': 'h264 high 10',
        '7a': 'h264 high 4:2:2',
        f4: 'h264 high 4:4:4 predictive',
        '53': 'h264 scalable baseline',
        '56': 'h264 scalable high',
        '76': 'h264 multiview high',
        '80': 'h264 stereo high',
      };
      return profiles[avc[1].toLowerCase()];
    }
    return undefined;
  };
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
      let codecs: string | undefined;
      let codecFields = 0;
      let forceParameters = true;
      for (const piece of pieces.slice(1)) {
        const match = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(piece);
        const key = (match?.[1] ?? piece.trim()).toLowerCase();
        if (key === 'codecs') {
          codecFields++;
          const raw = match?.[2];
          codecs =
            raw?.startsWith('"') && /^"[^"\\]*"$/.test(raw)
              ? raw.slice(1, -1)
              : raw;
        }
        if (!owned.has(key)) {
          if (key !== 'codecs' || !match || !/^"[^"\\]+"$/.test(match[2]))
            forceParameters = false;
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
      const supported = Reflect.apply(target, receiver, [
        modified ? kept.join(';') : type,
      ]);
      if (
        (preferences.mode === 'auto' && (!supported || !hardware)) ||
        !/^\s*video\//i.test(pieces[0]) ||
        !codecFields
      )
        return supported;
      if (codecFields !== 1 || !codecs) {
        unknownProfile();
        return supported;
      }
      const codecList = codecs.split(',').map((value) => value.trim());
      let forceCodec = false;
      for (const codec of codecList) {
        const family = /^(?:vp9|vp09)(?:\.|$)/i.test(codec)
          ? 'vp9'
          : /^av01(?:\.|$)/i.test(codec)
            ? 'av1'
            : null;
        if (
          preferences.mode !== 'auto' &&
          family &&
          !preferences.allowedCodecs.includes(family)
        )
          return false;
        if (!/^(?:vp9|vp09|av01|avc1|avc3)(?:\.|$)/i.test(codec)) continue;
        const profile = profileFor(codec);
        if (!profile) {
          unknownProfile();
          continue;
        }
        if (hardware && !hardware.has(profile as HardwareVideoProfile))
          return false;
        if (preferences.mode === 'force' && family) {
          // Deliberately narrow override: mandatory codec fields only. Extended
          // colour strings and mixed codec lists retain native validation.
          // https://www.webmproject.org/vp9/mp4/#codecs-parameter-string
          // https://aomediacodec.github.io/av1-isobmff/#codecsparam
          const vp =
            /^vp09\.0([0-3])\.(10|11|20|21|30|31|40|41|50|51|52|60|61|62)\.(08|10|12)$/.exec(
              codec,
            );
          const av = /^av01\.([012])\.(\d{2})([MH])\.(08|10|12)$/.exec(codec);
          forceCodec =
            codec === 'vp9' ||
            codec === 'vp9.0' ||
            !!(vp && (Number(vp[1]) < 2 ? vp[3] === '08' : vp[3] !== '08')) ||
            !!(
              av &&
              Number(av[2]) <= 23 &&
              (av[3] === 'M' || Number(av[2]) >= 8) &&
              (av[1] === '2' || av[4] !== '12')
            );
        }
      }
      if (
        !supported &&
        preferences.mode === 'force' &&
        forceCodec &&
        forceParameters &&
        codecList.length === 1
      ) {
        const mime = pieces[0].trim().toLowerCase();
        // Check the container through Chromium with a baseline codec. This
        // bypasses only the selected codec verdict, never arbitrary MIME types.
        if (mime === 'video/mp4' || mime === 'video/webm')
          return Reflect.apply(target, receiver, [
            `${mime};codecs="${mime === 'video/mp4' ? 'avc1.42E01E' : 'vp8'}"`,
          ]);
      }
      if (!supported && preferences.mode === 'force')
        warning ??=
          'Codec query outside the supported Force scope; native codec support is used for that query.';
      return supported;
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
  return {
    takeWarning() {
      const value = warning;
      warning = null;
      return value;
    },
  };
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
  const snapshot = bootstrapHardwareCodecs();
  const control = contextBridge.executeInMainWorld({
    func: overrideCobaltMediaCapabilities,
    args: [
      cobaltMediaLimits(display),
      snapshot?.hardware?.status === 'ready'
        ? snapshot.hardware.profiles
        : null,
      snapshot?.preferences,
    ],
  });
  // Unknown native-supported profile strings retain native behavior, with one
  // diagnostic. Follow the existing player-display diagnostic control pattern.
  if (snapshot && control) {
    const timer = setInterval(() => {
      try {
        const message = control.takeWarning();
        if (!message) return;
        ipcRenderer.send(HARDWARE_CODECS_IPC.failure, message);
        clearInterval(timer);
      } catch (cause) {
        clearInterval(timer);
        ipcRenderer.send(
          HARDWARE_CODECS_IPC.failure,
          `Hardware codec diagnostics failed: ${String(cause)}`.slice(0, 1000),
        );
      }
    }, 1000);
    window.addEventListener('pagehide', () => clearInterval(timer), {
      once: true,
    });
  }
}
