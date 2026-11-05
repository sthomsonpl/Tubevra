export const SELECTABLE_VIDEO_CODECS = ['vp9', 'av1'] as const;
export type SelectableVideoCodec = (typeof SELECTABLE_VIDEO_CODECS)[number];
export interface CodecPreferences {
  readonly mode: 'auto' | 'manual' | 'force';
  readonly allowedCodecs: readonly SelectableVideoCodec[];
}

export const DEFAULT_CODEC_PREFERENCES: CodecPreferences = Object.freeze({
  mode: 'auto',
  allowedCodecs: Object.freeze([...SELECTABLE_VIDEO_CODECS]),
});

export function isCodecPreferences(value: unknown): value is CodecPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === 2 &&
    (data.mode === 'auto' || data.mode === 'manual' || data.mode === 'force') &&
    Array.isArray(data.allowedCodecs) &&
    data.allowedCodecs.length <= SELECTABLE_VIDEO_CODECS.length &&
    Array.from(data.allowedCodecs).every((codec) =>
      SELECTABLE_VIDEO_CODECS.includes(codec),
    ) &&
    new Set(data.allowedCodecs).size === data.allowedCodecs.length
  );
}

export function freezeCodecPreferences(value: unknown): CodecPreferences {
  if (!isCodecPreferences(value)) throw Error('Invalid codec preferences.');
  return Object.freeze({
    mode: value.mode,
    allowedCodecs: Object.freeze([...value.allowedCodecs]),
  });
}

// Contract for the future bootstrap integration. Force never fabricates a
// hardware detection result; null explicitly means detection is not needed.
export type CodecBootstrapSnapshot =
  | {
      preferences: CodecPreferences & { readonly mode: 'auto' | 'manual' };
      hardware: HardwareCodecSnapshot;
    }
  | {
      preferences: CodecPreferences & { readonly mode: 'force' };
      hardware: null;
    };

export function isCodecBootstrapSnapshot(
  value: unknown,
): value is CodecBootstrapSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === 2 &&
    isCodecPreferences(data.preferences) &&
    (data.preferences.mode === 'force'
      ? data.hardware === null
      : isHardwareCodecSnapshot(data.hardware))
  );
}

export function freezeCodecBootstrapSnapshot(
  value: unknown,
): CodecBootstrapSnapshot {
  if (!isCodecBootstrapSnapshot(value))
    throw Error('Invalid codec bootstrap snapshot.');
  const preferences = freezeCodecPreferences(value.preferences);
  return Object.freeze({
    preferences,
    hardware:
      value.hardware === null
        ? null
        : freezeHardwareCodecSnapshot(value.hardware),
  }) as CodecBootstrapSnapshot;
}

export const HARDWARE_VIDEO_PROFILES = [
  'h264 baseline',
  'h264 main',
  'h264 extended',
  'h264 high',
  'h264 high 10',
  'h264 high 4:2:2',
  'h264 high 4:4:4 predictive',
  'h264 scalable baseline',
  'h264 scalable high',
  'h264 stereo high',
  'h264 multiview high',
  'vp9 profile0',
  'vp9 profile1',
  'vp9 profile2',
  'vp9 profile3',
  'av1 profile main',
  'av1 profile high',
  'av1 profile pro',
] as const;

export type HardwareVideoProfile = (typeof HARDWARE_VIDEO_PROFILES)[number];
export type HardwareCodecSnapshot =
  | { status: 'ready'; profiles: readonly HardwareVideoProfile[] }
  | { status: 'disabled'; profiles: readonly [] }
  | { status: 'error'; error: string };

export const HARDWARE_CODECS_IPC = Object.freeze({
  bootstrap: 'tubevra:hardware-codecs:bootstrap',
  failure: 'tubevra:hardware-codecs:failure',
});

export function hasCobaltUserAgent(value: string): boolean {
  return /(?:^|[\s;(])Cobalt\/\d[^\s;)]*/i.test(value);
}

export function freezeHardwareCodecSnapshot(
  value: unknown,
): HardwareCodecSnapshot {
  if (!isHardwareCodecSnapshot(value))
    throw Error('Invalid hardware codec snapshot.');
  if (value.status === 'error')
    return Object.freeze({ status: 'error', error: value.error });
  if (value.status === 'disabled')
    return Object.freeze({
      status: 'disabled',
      profiles: Object.freeze([]) as readonly [],
    });
  return Object.freeze({
    status: 'ready',
    profiles: Object.freeze([...value.profiles]),
  });
}

export function isHardwareCodecSnapshot(
  value: unknown,
): value is HardwareCodecSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2) return false;
  if (data.status === 'error')
    return (
      typeof data.error === 'string' &&
      data.error.length > 0 &&
      data.error.length <= 1000
    );
  if (!Array.isArray(data.profiles)) return false;
  if (data.status === 'disabled') return data.profiles.length === 0;
  return (
    data.status === 'ready' &&
    data.profiles.every((p) => HARDWARE_VIDEO_PROFILES.includes(p)) &&
    new Set(data.profiles).size === data.profiles.length
  );
}

// Disabled/error states deliberately mean unknown, never "all codecs unsupported".
export function hardwareProfileSupport(
  snapshot: HardwareCodecSnapshot,
  profile: HardwareVideoProfile,
): boolean | undefined {
  return snapshot.status === 'ready'
    ? snapshot.profiles.includes(profile)
    : undefined;
}
