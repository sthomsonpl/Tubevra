import type { i18n, TOptions } from 'i18next';
import type { Language } from '../shared/i18n/language';

export function createLocalization(instance: i18n, initial: Language) {
  let language = initial;
  let translate = instance.getFixedT(language);
  document.documentElement.lang = language;
  return {
    get language() {
      return language;
    },
    setLanguage(next: Language) {
      if (language === next) return false;
      language = next;
      translate = instance.getFixedT(language);
      document.documentElement.lang = language;
      return true;
    },
    // Callers write these strings with textContent or setAttribute.
    t: (key: string, options?: TOptions) =>
      translate(key, { ...options, interpolation: { escapeValue: false } }),
    apply(root: HTMLElement) {
      for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]'))
        node.textContent = translate(node.dataset.i18n!);
      for (const attribute of ['title', 'aria-label']) {
        const data = 'data-i18n-' + attribute;
        for (const node of root.querySelectorAll<HTMLElement>(`[${data}]`))
          node.setAttribute(attribute, translate(node.getAttribute(data)!));
      }
    },
    error(detail: string) {
      if (language === 'en') return detail;
      return translate('common.operationError', {
        detail,
        interpolation: { escapeValue: false },
      });
    },
  };
}

export type Localization = ReturnType<typeof createLocalization>;
