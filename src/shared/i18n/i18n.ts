import { createInstance } from 'i18next';
import en from './en.json';
import pl from './pl.json';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type Language,
} from './language';

export async function createI18n(language: Language = DEFAULT_LANGUAGE) {
  const instance = createInstance();
  await instance.init({
    lng: language,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: DEFAULT_LANGUAGE,
    resources: { en: { translation: en }, pl: { translation: pl } },
  });
  return instance;
}
