import { createHash } from 'node:crypto';
import {
  validVideoId,
  type SegmentResult,
  type SponsorSegment,
} from './contracts';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_VIDEOS = 4096;
const MAX_SEGMENTS = 8192;
const MAX_VIDEO_SEGMENTS = 512;
// Bounds arithmetic while allowing durations far beyond ordinary YouTube videos.
const MAX_SECONDS = 315_576_000;
const DEFAULT_RETRY_MS = 60_000;

export function videoHashPrefix(videoId: string): string {
  if (!validVideoId(videoId)) throw TypeError('Invalid YouTube video ID.');
  return createHash('sha256').update(videoId, 'utf8').digest('hex').slice(0, 4);
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Validate the entire bucket and return only the exact requested video. The
// byte bound here supplements the streaming limit enforced by the transport.
export function parseSponsorBucket(
  body: Uint8Array,
  videoId: string,
  prefix: string,
): SegmentResult {
  if (
    !validVideoId(videoId) ||
    prefix !== videoHashPrefix(videoId) ||
    !(body instanceof Uint8Array) ||
    body.byteLength > MAX_RESPONSE_BYTES
  )
    return { kind: 'invalid-data' };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return { kind: 'invalid-data' };
  }
  if (!Array.isArray(value) || value.length > MAX_VIDEOS)
    return { kind: 'invalid-data' };
  const seen = new Set<string>();
  let total = 0;
  let matched: SponsorSegment[] | undefined;
  for (const entry of value) {
    if (
      !object(entry) ||
      !validVideoId(entry.videoID) ||
      videoHashPrefix(entry.videoID) !== prefix ||
      seen.has(entry.videoID) ||
      !Array.isArray(entry.segments)
    )
      return { kind: 'invalid-data' };
    seen.add(entry.videoID);
    total += entry.segments.length;
    if (
      total > MAX_SEGMENTS ||
      (entry.videoID === videoId && entry.segments.length > MAX_VIDEO_SEGMENTS)
    )
      return { kind: 'invalid-data' };
    const segments: SponsorSegment[] = [];
    for (const item of entry.segments) {
      if (
        !object(item) ||
        item.category !== 'sponsor' ||
        item.actionType !== 'skip' ||
        !Array.isArray(item.segment) ||
        item.segment.length !== 2 ||
        typeof item.segment[0] !== 'number' ||
        typeof item.segment[1] !== 'number' ||
        !Number.isFinite(item.segment[0]) ||
        !Number.isFinite(item.segment[1]) ||
        item.segment[0] < 0 ||
        item.segment[0] >= item.segment[1] ||
        item.segment[1] > MAX_SECONDS ||
        typeof item.videoDuration !== 'number' ||
        !Number.isFinite(item.videoDuration) ||
        item.videoDuration < 0 ||
        item.videoDuration > MAX_SECONDS
      )
        return { kind: 'invalid-data' };
      if (entry.videoID === videoId)
        segments.push({
          start: item.segment[0],
          end: item.segment[1],
          videoDuration: item.videoDuration,
        });
    }
    if (entry.videoID === videoId) matched = segments;
  }
  return matched?.length
    ? { kind: 'segments', segments: matched }
    : { kind: 'empty' };
}

// Infinity means that a valid delta is too large for safe millisecond arithmetic;
// a future caller must not shorten that interval or schedule a retry timer for it.
export function retryAfterMilliseconds(
  value: unknown,
  wallNow: number,
): number {
  if (typeof value !== 'string' || !Number.isFinite(wallNow))
    return DEFAULT_RETRY_MS;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const digits = text.replace(/^0+/, '') || '0';
    if (digits.length > 16) return Infinity;
    const seconds = Number(digits);
    return seconds > Number.MAX_SAFE_INTEGER / 1000 ? Infinity : seconds * 1000;
  }
  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      text,
    )
  )
    return DEFAULT_RETRY_MS;
  const date = Date.parse(text);
  if (!Number.isFinite(date) || new Date(date).toUTCString() !== text)
    return DEFAULT_RETRY_MS;
  return Math.max(0, date - wallNow);
}
