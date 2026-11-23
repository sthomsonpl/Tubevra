import type { Language } from './i18n/language';

export type RatingsSnapshot = { version: number; generation: number } & (
  | { kind: 'no-video' | 'unsupported-player' }
  | { kind: 'loading' | 'empty' | 'error' | 'rate-limited'; videoId: string }
  | { kind: 'ready'; videoId: string; likes: number; dislikes: number }
);

export const RATINGS_IPC = Object.freeze({
  get: 'tubevra:ratings:get',
  changed: 'tubevra:ratings:changed',
  getLanguage: 'tubevra:ratings:get-language',
  languageChanged: 'tubevra:ratings:language-changed',
});
export interface RatingsAPI {
  getLanguage(): Promise<Language>;
  onLanguageChanged(listener: (language: Language) => void): () => void;
  getSnapshot(): Promise<RatingsSnapshot>;
  subscribe(listener: (state: RatingsSnapshot) => void): () => void;
}
