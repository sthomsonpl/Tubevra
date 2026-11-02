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
