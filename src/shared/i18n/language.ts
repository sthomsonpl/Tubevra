export const SUPPORTED_LANGUAGES = ['en', 'pl'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value);
}
