import { validVideoId, type SegmentResult } from './contracts';
import {
  parseSponsorBucket,
  retryAfterMilliseconds,
  videoHashPrefix,
} from './api-validation';
import type { SponsorTransport } from './transport';

export interface SponsorClock {
  monotonic(): number;
  wall(): number;
}
export const sponsorClock: SponsorClock = {
  monotonic: () => performance.now(),
  wall: () => Date.now(),
};

export function createSponsorCooldown(clock: SponsorClock) {
  let blockedUntil = 0;
  return {
    remaining() {
      return Math.min(
        Math.max(0, blockedUntil - clock.monotonic()),
        Number.MAX_SAFE_INTEGER,
      );
    },
    observe(retryAfter: string | undefined) {
      const delay = retryAfterMilliseconds(retryAfter, clock.wall());
      const now = clock.monotonic();
      blockedUntil = Math.max(blockedUntil, now + delay);
      return Math.min(blockedUntil - now, Number.MAX_SAFE_INTEGER);
    },
  };
}

// A client is owned by main; no operation here accepts a URL, headers or filters.
export function createSponsorApiClient(
  transport: SponsorTransport,
  clock: SponsorClock = sponsorClock,
  cooldown = createSponsorCooldown(clock),
) {
  return async (
    videoId: string,
    signal: AbortSignal,
  ): Promise<SegmentResult> => {
    if (!validVideoId(videoId)) return { kind: 'invalid-data' };
    if (signal.aborted) return { kind: 'cancelled' };
    const remaining = cooldown.remaining();
    if (remaining > 0)
      return {
        kind: 'rate-limited',
        retryAfterMs: remaining,
      };
    const prefix = videoHashPrefix(videoId);
    let response: Awaited<ReturnType<SponsorTransport>>;
    try {
      response = await transport(prefix, signal);
    } catch {
      return signal.aborted ? { kind: 'cancelled' } : { kind: 'network-error' };
    }
    // A cancellation racing an already-received 429 must not erase the server's limit.
    if (response.kind === 'response' && response.status === 429) {
      const retryAfterMs = cooldown.observe(response.retryAfter);
      return signal.aborted
        ? { kind: 'cancelled' }
        : {
            kind: 'rate-limited',
            retryAfterMs,
          };
    }
    if (signal.aborted) return { kind: 'cancelled' };
    if (response.kind !== 'response') return response;
    if (response.status === 404) return { kind: 'empty' };
    if (response.status !== 200) return { kind: 'service-error' };
    return parseSponsorBucket(response.body, videoId, prefix);
  };
}
