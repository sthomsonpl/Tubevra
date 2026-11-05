import type { AppState } from '../shared/api';
import type { CodecPreferences } from '../shared/media-capabilities';
import { createWidgetRow } from './widgets';

export function mountCodecSettings(
  root: HTMLElement,
  onApply: (preferences: CodecPreferences) => void,
  onReload: () => void,
) {
  const row = createWidgetRow('Video codecs');
  const icon = document.createElement('span');
  icon.className = 'row-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/></svg>';
  row.row.prepend(icon);
  const mode = document.createElement('select');
  mode.id = 'codec-mode';
  mode.className = 'ui-select';
  mode.setAttribute('aria-label', 'Video codec mode');
  for (const [value, name] of [
    ['auto', 'Auto'],
    ['manual', 'Manual'],
    ['force', 'Force'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = name;
    mode.append(option);
  }
  const button = document.createElement('button');
  button.id = 'codec-settings-open';
  button.type = 'button';
  button.className = 'ui-button secondary compact-btn';
  button.textContent = 'Settings';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', 'Configure video codecs');
  row.row.append(button, mode);
  const feedback = document.createElement('p');
  feedback.id = 'codec-feedback';
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const reload = document.createElement('button');
  reload.id = 'codec-reload';
  reload.type = 'button';
  reload.className = 'ui-button secondary compact-btn';
  reload.textContent = 'Reload YouTube TV';
  reload.hidden = true;
  reload.addEventListener('click', onReload);
  const blocker = document.createElement('dialog');
  blocker.id = 'codec-settings-blocker';
  blocker.className = 'extension-settings-blocker';
  blocker.setAttribute('aria-label', 'Video codec settings');
  // The widget itself belongs to the same card as playback resolution.
  root.replaceWith(row.row);
  row.copy.append(feedback, reload);
  row.row.append(blocker);
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
    if (error) report(error);
    button.focus({ preventScroll: true });
  });
  blocker.addEventListener('cancel', (event) => {
    event.preventDefault();
    void window.extensionSettingsHost
      .close()
      .then((result) => {
        if (!result.ok) report(result.error);
      })
      .catch(() => report('Cannot communicate with Tubevra.'));
  });
  button.addEventListener('click', async () => {
    blocker.showModal();
    try {
      const result = await window.extensionSettingsHost.open('codecs');
      if (!result.ok) {
        blocker.close();
        report(result.error);
      }
    } catch {
      blocker.close();
      report('Cannot communicate with Tubevra.');
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
