import type { AppState } from '../shared/api';
import type { CodecPreferences } from '../shared/media-capabilities';
import { createWidgetRow } from './widgets';
import type { Localization } from './localization';

export function mountCodecSettings(
  root: HTMLElement,
  locale: Localization,
  onApply: (preferences: CodecPreferences) => void,
  onReload: () => void,
) {
  const { t } = locale;
  const row = createWidgetRow('');
  row.copy.querySelector('strong')!.dataset.i18n = 'codecs.title';
  const icon = document.createElement('span');
  icon.className = 'row-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/></svg>';
  row.row.prepend(icon);
  const mode = document.createElement('select');
  mode.id = 'codec-mode';
  mode.className = 'ui-select';
  mode.setAttribute('data-i18n-aria-label', 'codecs.mode');
  for (const [value, key] of [
    ['auto', 'common.auto'],
    ['manual', 'codecs.manual'],
    ['force', 'codecs.force'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.dataset.i18n = key;
    mode.append(option);
  }
  const button = document.createElement('button');
  button.id = 'codec-settings-open';
  button.type = 'button';
  button.className = 'ui-button secondary compact-btn';
  button.dataset.i18n = 'common.settings';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('data-i18n-aria-label', 'codecs.configure');
  row.row.append(button, mode);
  const feedback = document.createElement('p');
  feedback.id = 'codec-feedback';
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const reload = document.createElement('button');
  reload.id = 'codec-reload';
  reload.type = 'button';
  reload.className = 'ui-button secondary compact-btn';
  reload.dataset.i18n = 'common.reloadTv';
  reload.hidden = true;
  reload.addEventListener('click', onReload);
  const blocker = document.createElement('dialog');
  blocker.id = 'codec-settings-blocker';
  blocker.className = 'extension-settings-blocker';
  blocker.setAttribute('data-i18n-aria-label', 'codecs.settings');
  // The widget itself belongs to the same card as playback resolution.
  root.replaceWith(row.row);
  row.copy.append(feedback, reload);
  row.row.append(blocker);
  locale.apply(row.row);
  let current: AppState | null = null;
  mode.addEventListener('change', () => {
    if (current && ['auto', 'manual', 'force'].includes(mode.value))
      onApply({
        mode: mode.value as CodecPreferences['mode'],
        allowedCodecs: current.general.codecPreferences.allowedCodecs,
      });
  });
  const report = (error: string) => {
    feedback.textContent = error;
    feedback.classList.add('error');
  };
  window.extensionSettingsHost.onClosed((error) => {
    if (!blocker.open) return;
    blocker.close();
    if (error) report(locale.error(error));
    button.focus({ preventScroll: true });
  });
  blocker.addEventListener('cancel', (event) => {
    event.preventDefault();
    void window.extensionSettingsHost
      .close()
      .then((result) => {
        if (!result.ok) report(locale.error(result.error));
      })
      .catch(() => report(t('common.communicationError')));
  });
  button.addEventListener('click', async () => {
    blocker.showModal();
    try {
      const result = await window.extensionSettingsHost.open('codecs');
      if (!result.ok) {
        blocker.close();
        report(locale.error(result.error));
      }
    } catch {
      blocker.close();
      report(t('common.communicationError'));
    }
  });
  return {
    feedback,
    render(state: AppState | null, busy: boolean) {
      current = state;
      mode.disabled = button.disabled = busy || !state;
      reload.disabled = busy;
      reload.hidden = !state?.codecReloadRequired;
      mode.value = state?.general.codecPreferences.mode ?? 'auto';
    },
  };
}
