import {
  createSponsorApiClient,
  createSponsorCooldown,
  sponsorClock,
  type SponsorClock,
} from './api';
import {
  validVideoId,
  type SegmentResult,
  type SponsorSegmentsHandler,
} from './contracts';
import type { SponsorTransport, SponsorTransportResult } from './transport';
import type { SponsorAvailability } from './diagnostics';

const MAX_CACHE_BYTES = 1024 * 1024;
const MAX_CACHE_ITEMS = 64;
const MAX_WAITERS = 8;
const MAX_HTTP = 2;
const POSITIVE_TTL = 15 * 60_000;
const EMPTY_TTL = 2 * 60_000;
const ERROR_TTL = 30_000;
// Allow the service to classify a timeout before the bridge's 10-second limit.
const FLIGHT_TIMEOUT = 9500;

type Waiter = { finish: (value: SponsorTransportResult) => void };
type Flight = {
  abort: AbortController;
  waiters: Set<Waiter>;
  timer?: ReturnType<typeof setTimeout>;
};

// The coordinator lives for the process; each enabled instance owns and clears
// its own cache and pending requests. Only limit metadata survives disable.
export function createSponsorCoordinator(
  transport: SponsorTransport,
  clock: SponsorClock = sponsorClock,
) {
  const cooldown = createSponsorCooldown(clock);
  let tokens = 4;
  let lastRefill = clock.monotonic();
  let active = false;
  function takeToken() {
    const now = clock.monotonic();
    if (now > lastRefill) {
      tokens = Math.min(4, tokens + (now - lastRefill) / 2000);
      lastRefill = now;
    }
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }
  return {
    start(report?: (value: Exclude<SponsorAvailability, 'unknown'>) => void) {
      if (active) throw Error('SponsorBlock service is already running.');
      active = true;
      let closed = false;
      let waiterCount = 0;
      let cacheBytes = 0;
      const cache = new Map<string, { data: Buffer; expires: number }>();
      const errors = new Map<
        string,
        { result: SegmentResult; expires: number }
      >();
      const flights = new Map<string, Flight>();

      const shared: SponsorTransport = (prefix, signal) => {
        if (closed || signal.aborted)
          return Promise.resolve({ kind: 'cancelled' });
        let flight = flights.get(prefix);
        if (!flight) {
          if (flights.size >= MAX_HTTP || !takeToken())
            return Promise.resolve({ kind: 'busy' });
          flight = { abort: new AbortController(), waiters: new Set() };
          flights.set(prefix, flight);
          const current = flight;
          current.timer = setTimeout(() => {
            if (flights.get(prefix) === current) flights.delete(prefix);
            for (const waiter of current.waiters)
              waiter.finish({ kind: 'timeout' });
            current.abort.abort();
          }, FLIGHT_TIMEOUT);
          void Promise.resolve()
            .then(() =>
              current.abort.signal.aborted
                ? ({ kind: 'cancelled' } as SponsorTransportResult)
                : transport(prefix, current.abort.signal),
            )
            .catch((): SponsorTransportResult => ({ kind: 'network-error' }))
            .then((response) => {
              clearTimeout(current.timer);
              // Record a received 429 even when the last caller cancels just
              // before the transport promise settles, including during disable.
              if (response.kind === 'response' && response.status === 429)
                cooldown.observe(response.retryAfter);
              if (flights.get(prefix) === current) flights.delete(prefix);
              for (const waiter of current.waiters) waiter.finish(response);
            });
        }
        const current = flight;
        return new Promise<SponsorTransportResult>((resolve) => {
          let finished = false;
          const waiter: Waiter = {
            finish(value) {
              if (finished) return;
              finished = true;
              signal.removeEventListener('abort', cancel);
              current.waiters.delete(waiter);
              resolve(value);
            },
          };
          const cancel = () => {
            waiter.finish({ kind: 'cancelled' });
            if (!current.waiters.size) {
              clearTimeout(current.timer);
              if (flights.get(prefix) === current) flights.delete(prefix);
              current.abort.abort();
            }
          };
          current.waiters.add(waiter);
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted || closed) cancel();
        });
      };
      const client = createSponsorApiClient(shared, clock, cooldown);
      function forget(id: string) {
        const item = cache.get(id);
        if (item) cacheBytes -= item.data.byteLength;
        cache.delete(id);
      }
      function store(id: string, result: SegmentResult) {
        const data = Buffer.from(JSON.stringify(result), 'utf8');
        if (data.byteLength > MAX_CACHE_BYTES) return;
        forget(id);
        while (
          cache.size >= MAX_CACHE_ITEMS ||
          cacheBytes + data.byteLength > MAX_CACHE_BYTES
        )
          forget(cache.keys().next().value!);
        cache.set(id, {
          data,
          expires:
            clock.monotonic() +
            (result.kind === 'empty' ? EMPTY_TTL : POSITIVE_TTL),
        });
        cacheBytes += data.byteLength;
      }
      const get: SponsorSegmentsHandler = async (videoId, signal) => {
        if (closed || signal.aborted) return { kind: 'cancelled' };
        if (!validVideoId(videoId)) return { kind: 'invalid-data' };
        const cached = cache.get(videoId);
        if (cached && cached.expires > clock.monotonic()) {
          cache.delete(videoId);
          cache.set(videoId, cached);
          return JSON.parse(cached.data.toString('utf8')) as SegmentResult;
        }
        if (cached) forget(videoId);
        const failure = errors.get(videoId);
        if (failure && failure.expires > clock.monotonic())
          return { ...failure.result };
        if (failure) errors.delete(videoId);
        if (waiterCount >= MAX_WAITERS) {
          report?.('busy');
          return { kind: 'busy' };
        }
        waiterCount++;
        try {
          const result = await client(videoId, signal);
          if (closed || signal.aborted) return { kind: 'cancelled' };
          if (result.kind === 'segments' || result.kind === 'empty')
            report?.('available');
          else if (result.kind !== 'cancelled') report?.(result.kind);
          if (result.kind === 'segments' || result.kind === 'empty') {
            errors.delete(videoId);
            store(videoId, result);
          } else if (
            [
              'network-error',
              'service-error',
              'timeout',
              'invalid-data',
            ].includes(result.kind)
          ) {
            errors.delete(videoId);
            if (errors.size >= MAX_CACHE_ITEMS)
              errors.delete(errors.keys().next().value!);
            errors.set(videoId, {
              result,
              expires: clock.monotonic() + ERROR_TTL,
            });
          }
          return result;
        } finally {
          waiterCount--;
        }
      };
      return {
        get,
        dispose() {
          if (closed) return;
          closed = true;
          active = false;
          cache.clear();
          cacheBytes = 0;
          errors.clear();
          for (const flight of flights.values()) {
            clearTimeout(flight.timer);
            flight.abort.abort();
            for (const waiter of flight.waiters)
              waiter.finish({ kind: 'cancelled' });
          }
          flights.clear();
        },
      };
    },
  };
}
