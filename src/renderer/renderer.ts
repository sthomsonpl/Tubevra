import './index.css';
import { mountSettings } from './settings';
import { mountToolbar } from './toolbar';
import { mountRatings } from './ratings';
import { mountRydSettings } from './extensions/ryd-settings';
import { mountCodecOptions } from './codec-options';
import { createI18n } from '../shared/i18n/i18n';
import { DEFAULT_LANGUAGE, type Language } from '../shared/i18n/language';
import { createLocalization } from './localization';

async function mount() {
  const root = document.querySelector<HTMLElement>('#app')!;
  const route = location.hash;
  let language: Language = DEFAULT_LANGUAGE;
  try {
    if (route === '#ratings') language = await window.ratings.getLanguage();
    else if (route === '#extension-settings')
      language = await window.extensionSettings.getLanguage();
    else if (route === '#codec-settings')
      language = await window.codecSettings.getLanguage();
    else {
      const result = await window.tubevra.getState();
      if (!result.ok) throw new Error(result.error);
      language = result.value.general.language;
    }
  } catch (error) {
    console.error('Cannot read the Tubevra interface language:', error);
  }
  const locale = createLocalization(await createI18n(language), language);
  if (route === '#toolbar') mountToolbar(root, locale);
  else if (route === '#ratings') mountRatings(root, locale);
  else if (route === '#extension-settings') mountRydSettings(root, locale);
  else if (route === '#codec-settings') mountCodecOptions(root, locale);
  else mountSettings(root, locale);
}

void mount();
