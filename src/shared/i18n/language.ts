export const SUPPORTED_LANGUAGES = ['en', 'pl'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
export const DEFAULT_LANGUAGE_PREFERENCE = 'auto';
export type LanguagePreference = Language | typeof DEFAULT_LANGUAGE_PREFERENCE;

export function isLanguagePreference(
  value: unknown,
): value is LanguagePreference {
  return (
    value === DEFAULT_LANGUAGE_PREFERENCE ||
    SUPPORTED_LANGUAGES.some((language) => language === value)
  );
}
