import type { AppState } from '../shared/api';
import type { Localization } from './localization';

export function mountToolbar(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  document.body.className = 'toolbar-page';
  root.innerHTML = `<nav class="toolbar" aria-label="Tubevra">
    <button id="back" type="button" data-i18n-title="toolbar.backInTv" data-i18n-aria-label="toolbar.back" class="ui-button ui-button--dock">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13"/></svg><span data-i18n="toolbar.back"></span>
    </button>
    <button id="home" type="button" data-i18n-title="toolbar.tvHome" data-i18n-aria-label="toolbar.home" class="ui-button ui-button--dock">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/></svg><span data-i18n="toolbar.home"></span>
    </button>
    <button id="fullscreen" type="button" aria-pressed="false" class="ui-button ui-button--dock">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg><span data-i18n="toolbar.fullscreen"></span>
    </button>
    <button id="settings" type="button" data-i18n-title="toolbar.settingsTooltip" data-i18n-aria-label="common.settings" class="ui-button ui-button--dock">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/></svg><span data-i18n="common.settings"></span>
    </button>
  </nav><div class="toolbar-error" role="alert" hidden></div>`;
  const feedback = root.querySelector<HTMLElement>('.toolbar-error')!;
  let errorDetail: string | undefined;
  function showError(detail?: string) {
    errorDetail = detail;
    const message = detail ? locale.error(detail) : t('common.unavailable');
    feedback.textContent = message;
    feedback.title = message;
    feedback.hidden = false;
  }
  const back = root.querySelector<HTMLButtonElement>('#back')!;
  const home = root.querySelector<HTMLButtonElement>('#home')!;
  const settings = root.querySelector<HTMLButtonElement>('#settings')!;
  const fullscreen = root.querySelector<HTMLButtonElement>('#fullscreen')!;
  let busy = false;
  let current: AppState | null = null;
  function translateToolbar() {
    locale.apply(root);
    const label = t(
      current?.windowFullscreen
        ? 'toolbar.exitFullscreen'
        : 'toolbar.enterFullscreen',
    );
    fullscreen.title = t('toolbar.fullscreenShortcut', { action: label });
    fullscreen.setAttribute('aria-label', label);
    fullscreen.querySelector('span')!.textContent = t(
      current?.windowFullscreen
        ? 'toolbar.exitFullscreen'
        : 'toolbar.fullscreen',
    );
  }
  translateToolbar();
  function render(state: AppState) {
    current = state;
    const languageChanged = locale.setLanguage(state.general.language);
    back.disabled =
      busy || (!state.settingsOpen && (state.loading || !!state.error));
    home.disabled = busy || state.loading;
    settings.disabled = busy;
    fullscreen.disabled = busy;
    translateToolbar();
    if (languageChanged && !feedback.hidden) showError(errorDetail);
    fullscreen.setAttribute('aria-pressed', String(state.windowFullscreen));
    fullscreen
      .querySelector('path')!
      .setAttribute(
        'd',
        state.windowFullscreen
          ? 'M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5'
          : 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
      );
    settings.setAttribute('aria-pressed', String(state.settingsOpen));
  }
  async function run(action: () => ReturnType<typeof window.tubevra.navigate>) {
    if (busy) return;
    busy = true;
    feedback.hidden = true;
    if (current) render(current);
    try {
      const result = await action();
      if (result.ok === false) {
        showError(result.error);
        await window.tubevra.setSettingsOpen(true);
      } else render(result.value);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : undefined);
    } finally {
      busy = false;
      if (current) render(current);
    }
  }
  back.addEventListener('click', () => {
    if (current?.settingsOpen) {
      void run(() => window.tubevra.setSettingsOpen(false));
    } else {
      void run(() => window.tubevra.navigate('back'));
    }
  });
  home.addEventListener('click', () => {
    void run(async () => {
      if (current?.settingsOpen) {
        await window.tubevra.setSettingsOpen(false);
      }
      return window.tubevra.navigate('home');
    });
  });
  settings.addEventListener('click', () => {
    void run(() => window.tubevra.setSettingsOpen(!current?.settingsOpen));
  });
  fullscreen.addEventListener('click', () => {
    void run(() => window.tubevra.toggleFullscreen());
  });
  window.tubevra.onStateChanged(render);
  window.tubevra
    .getState()
    .then((result) => {
      if (current) return;
      if (result.ok === true) render(result.value);
      else showError(result.error);
    })
    .catch(() => {
      if (!current) showError();
    });
}
