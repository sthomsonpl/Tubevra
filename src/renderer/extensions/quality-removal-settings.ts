import { createSettingsDialog } from '../settings-dialog';
import { createWidgetCheckbox, createWidgetNotice } from '../widgets';
import {
  qualityRemovalName,
  qualityResolutions,
} from '../../extensions/quality-removal/quality-removal';
import type { Localization } from '../localization';

export function mountQualityRemovalSettings(
  root: HTMLElement,
  locale: Localization,
) {
  const { t } = locale;
  document.body.className = 'settings-page glass-active extension-options-page';
  const content = document.createElement('div');
  content.className = 'settings-dialog-content';
  const box = document.createElement('div');
  box.className = 'widget-box';
  const checkboxes = new Map<number, HTMLInputElement>();
  for (const resolution of qualityResolutions) {
    const checkbox = createWidgetCheckbox(`${resolution}p`, false);
    checkbox.input.id = `quality-${resolution}`;
    checkbox.input.disabled = true;
    checkboxes.set(resolution, checkbox.input);
    box.append(checkbox.label);
  }
  const notes = document.createElement('div');
  notes.className = 'ui-notice-group';
  notes.append(
    createWidgetNotice(
      `${t('addons.qualityRemoval.description')} ${t('addons.qualityRemoval.lastVariant')}`,
    ).notice,
    createWidgetNotice(t('addons.qualityRemoval.reload')).notice,
  );
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  content.append(box, notes, feedback);
  let saving = false;
  let ready = false;
  const settings = createSettingsDialog(qualityRemovalName, content, locale, {
    onOpen() {},
    onCancel() {
      if (!saving) void close();
    },
    onSave() {
      if (ready && !saving) void save();
    },
  });
  const dialog = settings.dialog;
  dialog.dataset.extensionId = 'quality-removal';
  const buttons = dialog.querySelectorAll('button');
  const saveButton = dialog.querySelector<HTMLButtonElement>('.primary')!;
  saveButton.disabled = true;
  const form = dialog.querySelector('form')!;
  form.addEventListener('submit', (event) => event.preventDefault());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!saving) void close();
  });
  async function close() {
    observer.disconnect();
    try {
      const result = await window.qualityRemovalSettings.close();
      if (!result.ok) {
        feedback.textContent = locale.error(result.error);
        observer.observe(form);
      } else dialog.close();
    } catch {
      feedback.textContent = t('common.communicationError');
      observer.observe(form);
    }
  }
  function controls() {
    for (const input of checkboxes.values()) input.disabled = saving || !ready;
    buttons.forEach((button) => {
      button.disabled = saving;
    });
    saveButton.disabled = saving || !ready;
  }
  async function save() {
    saving = true;
    feedback.textContent = '';
    controls();
    try {
      const hidden = [...checkboxes]
        .filter(([, input]) => input.checked)
        .map(([resolution]) => resolution);
      const result = await window.qualityRemovalSettings.save(hidden);
      if (!result.ok) feedback.textContent = locale.error(result.error);
      else await close();
    } catch {
      feedback.textContent = t('common.communicationError');
    } finally {
      saving = false;
      controls();
      updateSize();
    }
  }
  root.append(dialog);
  settings.button.click();
  let lastHeight = 0;
  const updateSize = () => {
    if (!dialog.open) return;
    const height = Math.max(
      160,
      Math.ceil(form.getBoundingClientRect().height) + 2,
    );
    if (height === lastHeight) return;
    lastHeight = height;
    void window.qualityRemovalSettings
      .resize(height)
      .then((result) => {
        if (!result.ok && dialog.open)
          feedback.textContent = locale.error(result.error);
      })
      .catch(() => {
        if (dialog.open) feedback.textContent = t('addons.resizeError');
      });
  };
  const observer = new ResizeObserver(updateSize);
  observer.observe(form);
  window.addEventListener('pagehide', () => observer.disconnect(), {
    once: true,
  });
  void window.qualityRemovalSettings
    .get()
    .then((result) => {
      if (result.ok) {
        for (const [resolution, input] of checkboxes)
          input.checked = result.value.includes(resolution);
        ready = true;
        controls();
        dialog.querySelector('h2')!.focus({ preventScroll: true });
      } else feedback.textContent = locale.error(result.error);
      updateSize();
    })
    .catch(() => {
      feedback.textContent = t('common.communicationError');
      updateSize();
    });
}
