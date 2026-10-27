// Private isolated-runtime controls; never exposed through contextBridge.
export const SPONSOR_IPC = {
  begin: 'tubevra:sponsor:begin',
  renew: 'tubevra:sponsor:renew',
  end: 'tubevra:sponsor:end',
  get: 'tubevra:sponsor:get',
  cancel: 'tubevra:sponsor:cancel',
};

// Data-only contracts. Never pass the private lease to hooks or the main world.
export interface SponsorSegment {
  start: number;
  end: number;
  videoDuration: number;
}
export type SegmentResult =
  | { kind: 'segments'; segments: SponsorSegment[] }
  | {
      kind:
        | 'empty'
        | 'cancelled'
        | 'timeout'
        | 'network-error'
        | 'service-error'
        | 'invalid-data'
        | 'busy';
    }
  | { kind: 'rate-limited'; retryAfterMs: number };

export type SponsorSegmentsHandler = (
  videoId: string,
  signal: AbortSignal,
) => SegmentResult | Promise<SegmentResult>;

export interface SponsorLease {
  document: string;
  revision: number;
  instance: string;
}
export interface SponsorRequest extends SponsorLease {
  request: number;
  videoId: string;
}
export interface SponsorResponse extends SponsorRequest {
  result: SegmentResult;
}
export type GetSponsorSegments = (
  videoId: string,
  options?: { signal?: AbortSignal },
) => Promise<SegmentResult>;

export const validVideoId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);

export function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

// Checks our bounded wire result, not the external SponsorBlock API response.
export function validSegmentResult(value: unknown): value is SegmentResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as SegmentResult;
  if (result.kind === 'segments')
    return (
      exactObject(value, ['kind', 'segments']) &&
      Array.isArray(result.segments) &&
      result.segments.length <= 512 &&
      result.segments.every(
        (segment) =>
          exactObject(segment, ['start', 'end', 'videoDuration']) &&
          Number.isFinite(segment.start) &&
          Number.isFinite(segment.end) &&
          segment.start >= 0 &&
          segment.start < segment.end &&
          Number.isFinite(segment.videoDuration) &&
          segment.videoDuration >= 0,
      )
    );
  if (result.kind === 'rate-limited')
    return (
      exactObject(value, ['kind', 'retryAfterMs']) &&
      Number.isFinite(result.retryAfterMs) &&
      result.retryAfterMs >= 0
    );
  return (
    exactObject(value, ['kind']) &&
    [
      'empty',
      'cancelled',
      'timeout',
      'network-error',
      'service-error',
      'invalid-data',
      'busy',
    ].includes(result.kind)
  );
}
