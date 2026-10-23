import type { Cleanup } from './types';

// A deadline bounds cooperative work; it cannot interrupt synchronous JavaScript.
export function deadline<T>(
  work: PromiseLike<T> | T,
  milliseconds: number,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(Error('Extension lifecycle timed out.'));
    }, milliseconds);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        if (expired) late?.(value);
        else resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        if (!expired) reject(cause);
      },
    );
  });
}
export function releaseLate(cleanup: Cleanup) {
  void Promise.resolve()
    .then(cleanup)
    .catch((cause) => console.error('Late extension cleanup failed:', cause));
}
