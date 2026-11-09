import { createSettingsDialog } from './settings-dialog';
import { createWidgetCheckbox, createWidgetNotice } from './widgets';
import type { CodecSettingsState } from '../shared/extension-settings';
import type { SelectableVideoCodec } from '../shared/media-capabilities';
import type { Localization } from './localization';

export function mountCodecOptions(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  document.body.className = 'settings-page glass-active extension-options-page';
  const content = document.createElement('div');
  content.className = 'settings-dialog-content';
  const box = document.createElement('div');
  const description = createWidgetNotice(t('codecs.description'));
  box.className = 'widget-box';
  const checkboxes = new Map<SelectableVideoCodec, HTMLInputElement>();
  for (const [codec, name] of [
    ['av1', 'AV1'],
    ['vp9', 'VP9'],
  ] as const) {
    const checkbox = createWidgetCheckbox(name, false);
    checkbox.input.id = `codec-${codec}`;
    checkboxes.set(codec, checkbox.input);
    box.append(checkbox.label);
  }
  const notes = document.createElement('div');
  notes.className = 'ui-notice-group';
  notes.append(createWidgetNotice(t('codecs.vp9Warning')).notice);
  const feedback = document.createElement('p');
  feedback.id = 'codec-options-feedback';
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.id = 'codec-options-reload';
  retry.type = 'button';
  retry.className = 'ui-button secondary';
  retry.textContent = t('common.reloadTv');
  retry.hidden = true;
  content.append(description.notice, box, notes, feedback, retry);
  let current: CodecSettingsState | null = null;
  let busy = false;
  const settings = createSettingsDialog(t('codecs.title'), content, locale, {
    subtitle: t('codecs.playbackSettings'),
    onOpen() {},
    onCancel: () => {
      if (!busy) void close();
    },
    onSave: () => {
      if (current && !busy) void save();
    },
  });
  const dialog = settings.dialog;
  dialog.id = 'codec-options';
  const form = dialog.querySelector('form')!;
  form.addEventListener('submit', (event) => event.preventDefault());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!busy) void close();
  });
  function controls() {
    for (const input of checkboxes.values()) input.disabled = busy || !current;
    for (const button of dialog.querySelectorAll('button'))
      button.disabled = busy;
    dialog.querySelector<HTMLButtonElement>('.primary')!.disabled =
      busy || !current;
    retry.hidden = !current?.reloadRequired;
  }
  function readState(state: CodecSettingsState) {
    current = state;
    for (const [codec, input] of checkboxes)
      input.checked = state.preferences.allowedCodecs.includes(codec);
    description.body.textContent = t(
      {
        auto: 'codecs.autoDescription',
        manual: 'codecs.manualDescription',
        force: 'codecs.description',
      }[state.preferences.mode],
    );
    controls();
  }
  async function close() {
    try {
      const result = await window.codecSettings.close();
      if (!result.ok) feedback.textContent = locale.error(result.error);
      else {
        observer.disconnect();
        dialog.close();
      }
    } catch {
      feedback.textContent = t('common.communicationError');
    }
  }
  async function save() {
    if (!current) return;
    busy = true;
    controls();
    feedback.textContent = '';
    const preferences = {
      mode: current.preferences.mode,
      allowedCodecs: [...checkboxes]
        .filter(([, input]) => input.checked)
        .map(([codec]) => codec),
    };
    try {
      const result = await window.codecSettings.save(preferences);
      if (result.ok) {
        readState(result.value);
        busy = false;
        await close();
      } else {
        feedback.textContent = locale.error(result.error);
        // A failed reload may follow a committed save; keep that distinction visible.
        const latest = await window.codecSettings.get();
        if (latest.ok && latest.value.reloadRequired) {
          readState(latest.value);
          feedback.textContent = t('common.savedWithError', {
            detail: result.error,
          });
        }
      }
    } catch {
      feedback.textContent = t('common.changesKept');
    } finally {
      busy = false;
      controls();
      resize();
    }
  }
  retry.addEventListener('click', async () => {
    busy = true;
    controls();
    try {
      const result = await window.codecSettings.reload();
      if (result.ok) {
        readState(result.value);
        feedback.textContent = t('common.applied');
      } else feedback.textContent = locale.error(result.error);
    } catch {
      feedback.textContent = t('common.communicationError');
    } finally {
      busy = false;
      controls();
      resize();
    }
  });
  let lastHeight = 0;
  function resize() {
    if (!dialog.open) return;
    const height = Math.max(
      160,
      Math.ceil(form.getBoundingClientRect().height) + 2,
    );
    if (height === lastHeight) return;
    lastHeight = height;
    void window.codecSettings
      .resize(height)
      .then((r) => {
        if (!r.ok) feedback.textContent = locale.error(r.error);
      })
      .catch(() => {
        feedback.textContent = t('codecs.resizeError');
      });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(form);
  window.addEventListener('pagehide', () => observer.disconnect(), {
    once: true,
  });
  root.append(dialog);
  controls();
  settings.button.click();
  void window.codecSettings
    .get()
    .then((result) => {
      if (result.ok) readState(result.value);
      else feedback.textContent = locale.error(result.error);
      resize();
    })
    .catch(() => {
      feedback.textContent = t('common.communicationError');
      resize();
    });
}
