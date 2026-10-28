import type { RatingsSnapshot } from '../../shared/ratings';
import type { RydResult } from './contracts';

export function createRydPresentation(
  get: (id: string, signal: AbortSignal) => Promise<RydResult>,
) {
  let snapshot: RatingsSnapshot = {
    version: 0,
    generation: 0,
    kind: 'no-video',
  };
  const listeners = new Set<(state: RatingsSnapshot) => void>();
  let abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let retries = 0;
  let film: string | null = null;
  type Content<T> = T extends unknown
    ? Omit<T, 'version' | 'generation'>
    : never;
  const publish = (value: Content<RatingsSnapshot>) => {
    snapshot = {
      ...value,
      version: snapshot.version + 1,
      generation: snapshot.generation,
    } as RatingsSnapshot;
    for (const listener of listeners) listener({ ...snapshot });
  };
  const cancel = () => {
    abort.abort();
    abort = new AbortController();
    clearTimeout(timer);
  };
  return {
    snapshot: () => ({ ...snapshot }),
    suspend() {
      cancel();
      publish({ kind: 'no-video' });
    },
    subscribe(listener: (state: RatingsSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bind(id: string | null, unsupported = false, preserveBudget = false) {
      if (closed) return;
      cancel();
      if (!preserveBudget || film !== id) retries = 0;
      film = id;
      snapshot = { ...snapshot, generation: snapshot.generation + 1 };
      if (!id) {
        publish({ kind: unsupported ? 'unsupported-player' : 'no-video' });
        return;
      }
      const current = abort;
      const valid = () =>
        !closed && current === abort && !current.signal.aborted;
      const request = async () => {
        if (!valid()) return;
        publish({ kind: 'loading', videoId: id });
        let result: RydResult;
        try {
          result = await get(id, current.signal);
        } catch {
          result = { kind: 'network-error', retryable: true };
        }
        if (!valid()) return;
        if (result.kind === 'ratings' && result.id === id) {
          publish({
            kind: 'ready',
            videoId: id,
            likes: result.likes,
            dislikes: result.dislikes,
          });
          return;
        }
        publish({
          kind:
            result.kind === 'empty'
              ? 'empty'
              : result.kind === 'rate-limited'
                ? 'rate-limited'
                : 'error',
          videoId: id,
        });
        const retry =
          result.kind === 'busy' ||
          result.kind === 'rate-limited' ||
          ('retryable' in result && result.retryable);
        if (!retry || retries >= 2) return;
        const delay =
          Math.max(
            30_000 * 2 ** retries++,
            result.kind === 'rate-limited' ? result.retryAfterMs : 0,
          ) +
          1 +
          Math.floor(Math.random() * 1000);
        const deadline = performance.now() + delay;
        const wait = () => {
          if (!valid()) return;
          const remaining = deadline - performance.now();
          if (remaining > 0)
            timer = setTimeout(wait, Math.min(remaining, 2_147_483_647));
          else void request();
        };
        wait();
      };
      void request();
    },
    dispose() {
      if (closed) return;
      cancel();
      publish({ kind: 'no-video' });
      closed = true;
      listeners.clear();
    },
  };
}
export type RydPresentation = ReturnType<typeof createRydPresentation>;
