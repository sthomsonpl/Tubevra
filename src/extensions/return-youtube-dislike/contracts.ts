export const RYD_IPC = 'tubevra:ryd:control';
export const validVideoId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);

export type RydResult =
  | { kind: 'ratings'; id: string; likes: number; dislikes: number }
  | { kind: 'empty' | 'cancelled' | 'busy' | 'invalid-data' }
  | { kind: 'rate-limited'; retryAfterMs: number }
  | { kind: 'network-error' | 'timeout' | 'service-error'; retryable: boolean };

export function parseRatings(body: Uint8Array, id: string): RydResult {
  if (!validVideoId(id) || body.byteLength > 64 * 1024)
    return { kind: 'invalid-data' };
  try {
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(body),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.id !== id ||
      !Number.isSafeInteger(value.likes) ||
      value.likes < 0 ||
      !Number.isSafeInteger(value.dislikes) ||
      value.dislikes < 0
    )
      return { kind: 'invalid-data' };
    return {
      kind: 'ratings',
      id,
      likes: value.likes,
      dislikes: value.dislikes,
    };
  } catch {
    return { kind: 'invalid-data' };
  }
}
