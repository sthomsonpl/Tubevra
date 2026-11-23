import { app } from 'electron';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../shared/i18n/language';

export function detectSystemLanguage(
  readPreferredLanguages = () => app.getPreferredSystemLanguages(),
): Language {
  try {
    for (const preferred of readPreferredLanguages()) {
      const code = preferred?.toLowerCase().split(/[-_.@]/)[0];
      const language = SUPPORTED_LANGUAGES.find(
        (supported) => supported === code,
      );
      if (language) return language;
    }
    return DEFAULT_LANGUAGE;
  } catch (error) {
    console.warn('Cannot read the preferred system language:', error);
    return DEFAULT_LANGUAGE;
  }
}
