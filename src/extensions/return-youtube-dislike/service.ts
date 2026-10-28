import { parseRatings, validVideoId, type RydResult } from './contracts';
import type { RydTransport, RydTransportResult } from './transport';

export interface RydClock {
  monotonic(): number;
  wall(): number;
}
const clock: RydClock = {
  monotonic: () => performance.now(),
  wall: () => Date.now(),
};
type Waiter = { finish(value: RydResult): void };
type Flight = { abort: AbortController; waiters: Set<Waiter> };

// Process-owned metadata contains timestamps only, never video IDs.
export function createRydCoordinator(
  transport: RydTransport,
  time: RydClock = clock,
) {
  let tokens = 4,
    refill = time.monotonic(),
    blockedUntil = 0,
    strikes = 0;
  const requests: number[] = [];
  let active = false,
    reserved = 0;
  function observe429(header?: string) {
    const fallback = Math.min(3_600_000, 60_000 * 2 ** Math.min(strikes++, 6));
    let delay = fallback;
    if (header && /^\d+$/.test(header)) delay = Number(header) * 1000;
    else if (header && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(header)) {
      const date = Date.parse(header);
      if (Number.isFinite(date)) delay = Math.max(0, date - time.wall());
    }
    // No timer is scheduled for cooldown; oversized valid delays fail closed.
    blockedUntil = Math.max(
      blockedUntil,
      time.monotonic() + Math.min(delay, Number.MAX_SAFE_INTEGER),
    );
  }
  return {
    start(report: (result: RydResult) => void = () => {}) {
      if (active) throw Error('RYD service is already running.');
      active = true;
      let closed = false,
        waiters = 0;
      const cache = new Map<string, { result: RydResult; expires: number }>();
      const flights = new Map<string, Flight>();
      function classify(response: RydTransportResult, id: string): RydResult {
        if (response.kind !== 'response') {
          if (response.kind === 'network-error' || response.kind === 'timeout')
            return { kind: response.kind, retryable: true };
          if (response.kind === 'service-error')
            return { kind: 'service-error', retryable: false };
          return {
            kind: response.kind as 'cancelled' | 'busy' | 'invalid-data',
          };
        }
        if (response.status === 429)
          return {
            kind: 'rate-limited',
            retryAfterMs: Math.min(
              Number.MAX_SAFE_INTEGER,
              Math.max(0, blockedUntil - time.monotonic()),
            ),
          };
        if (response.status === 404) return { kind: 'empty' };
        if (response.status === 200) return parseRatings(response.body, id);
        return {
          kind: 'service-error',
          retryable: response.status >= 500 && response.status <= 599,
        };
      }
      const get = (id: string, signal: AbortSignal): Promise<RydResult> => {
        if (closed || signal.aborted)
          return Promise.resolve({ kind: 'cancelled' });
        if (!validVideoId(id)) return Promise.resolve({ kind: 'invalid-data' });
        const now = time.monotonic();
        const item = cache.get(id);
        cache.delete(id);
        if (item && item.expires > now) {
          cache.set(id, item);
          return Promise.resolve({ ...item.result });
        }
        if (waiters >= 8) return Promise.resolve({ kind: 'busy' });
        let flight = flights.get(id);
        if (!flight) {
          if (blockedUntil > now)
            return Promise.resolve({
              kind: 'rate-limited',
              retryAfterMs: Math.min(
                Number.MAX_SAFE_INTEGER,
                blockedUntil - now,
              ),
            });
          while (requests.length && requests[0] <= now - 86_400_000)
            requests.shift();
          tokens = Math.min(4, tokens + Math.max(0, now - refill) / 2000);
          refill = now;
          if (requests.length + reserved >= 9000)
            return Promise.resolve({
              kind: 'rate-limited',
              retryAfterMs: Math.max(
                0,
                (requests[0] ?? now) + 86_400_000 - now,
              ),
            });
          if (flights.size >= 2 || tokens < 1)
            return Promise.resolve({ kind: 'busy' });
          flight = { abort: new AbortController(), waiters: new Set() };
          flights.set(id, flight);
          const current = flight;
          tokens--;
          reserved++;
          // Defer dispatch so synchronous cancellation consumes no HTTP budget.
          void Promise.resolve().then(async () => {
            reserved--;
            if (current.abort.signal.aborted) {
              tokens = Math.min(4, tokens + 1);
              return;
            }
            requests.push(time.monotonic());
            let response: RydTransportResult;
            try {
              response = await transport(id, current.abort.signal);
            } catch {
              response = { kind: 'network-error' };
            }
            if (response.kind === 'response' && response.status === 429)
              observe429(response.retryAfter);
            if (flights.get(id) === current) flights.delete(id);
            if (closed || current.abort.signal.aborted) return;
            const result = classify(response, id);
            if (
              response.kind === 'response' &&
              (response.status === 200 || response.status === 404)
            )
              strikes = 0;
            const ttl =
              result.kind === 'ratings'
                ? 300_000
                : result.kind === 'empty'
                  ? 60_000
                  : 'retryable' in result && result.retryable
                    ? 30_000
                    : 0;
            if (ttl) {
              cache.delete(id);
              if (cache.size >= 64) cache.delete(cache.keys().next().value!);
              cache.set(id, { result, expires: time.monotonic() + ttl });
            }
            report(result);
            for (const waiter of current.waiters) waiter.finish(result);
          });
        }
        const current = flight;
        waiters++;
        return new Promise((resolve) => {
          let done = false;
          const waiter: Waiter = {
            finish(value) {
              if (done) return;
              done = true;
              waiters--;
              current.waiters.delete(waiter);
              signal.removeEventListener('abort', cancel);
              resolve({ ...value });
            },
          };
          const cancel = () => {
            waiter.finish({ kind: 'cancelled' });
            if (!current.waiters.size) {
              if (flights.get(id) === current) flights.delete(id);
              current.abort.abort();
            }
          };
          current.waiters.add(waiter);
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
        });
      };
      return {
        get,
        dispose() {
          if (closed) return;
          closed = true;
          active = false;
          cache.clear();
          for (const flight of flights.values()) {
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
