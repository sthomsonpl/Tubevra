import { app } from 'electron';
import { DEFAULT_LANGUAGE, type Language } from '../shared/i18n/language';

export function detectSystemLanguage(
  readPreferredLanguages = () => app.getPreferredSystemLanguages(),
): Language {
  try {
    const [preferred] = readPreferredLanguages();
    const language = preferred?.toLowerCase().split('-')[0];
    return language === 'pl' ? 'pl' : DEFAULT_LANGUAGE;
  } catch (error) {
    console.warn('Cannot read the preferred system language:', error);
    return DEFAULT_LANGUAGE;
  }
}
