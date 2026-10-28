export type RatingsSnapshot = { version: number; generation: number } & (
  | { kind: 'no-video' | 'unsupported-player' }
  | { kind: 'loading' | 'empty' | 'error' | 'rate-limited'; videoId: string }
  | { kind: 'ready'; videoId: string; likes: number; dislikes: number }
);

export const RATINGS_IPC = Object.freeze({
  get: 'tubevra:ratings:get',
  changed: 'tubevra:ratings:changed',
});
export interface RatingsAPI {
  getSnapshot(): Promise<RatingsSnapshot>;
  subscribe(listener: (state: RatingsSnapshot) => void): () => void;
}
