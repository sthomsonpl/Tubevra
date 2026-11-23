import { createSettingsDialog } from '../settings-dialog';
import { createWidgetRow, createWidgetToggle } from '../widgets';
import type { Localization } from '../localization';

export function mountRydSettings(root: HTMLElement, locale: Localization) {
  const { t } = locale;
  document.body.className = 'settings-page glass-active extension-options-page';
  const content = document.createElement('div');
  content.className = 'settings-dialog-content';
  const box = document.createElement('div');
  box.className = 'widget-box';
  const option = createWidgetRow(
    t('addons.ryd.showWithDock'),
    t('addons.ryd.showWithDockDescription'),
  );
  const toggle = createWidgetToggle(
    t('common.enable', { name: t('addons.ryd.showWithDock') }),
    false,
  );
  toggle.input.dataset.controlId = 'ryd-show-with-dock';
  toggle.input.disabled = true;
  option.row.append(toggle.label);
  box.append(option.row);
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  content.append(box, feedback);
  let saving = false;
  let ready = false;
  const settings = createSettingsDialog(
    'Return YouTube Dislike',
    content,
    locale,
    {
      onOpen() {},
      onCancel() {
        if (!saving) void close();
      },
      onSave() {
        if (ready && !saving) void save();
      },
    },
  );
  const dialog = settings.dialog;
  dialog.dataset.extensionId = 'return-youtube-dislike';
  const buttons = dialog.querySelectorAll('button');
  const saveButton = dialog.querySelector<HTMLButtonElement>('.primary')!;
  saveButton.disabled = true;
  dialog
    .querySelector('form')!
    .addEventListener('submit', (event) => event.preventDefault());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!saving) void close();
  });
  async function close() {
    observer.disconnect();
    try {
      const result = await window.extensionSettings.close();
      if (!result.ok) {
        feedback.textContent = locale.error(result.error);
        observer.observe(form);
      } else dialog.close();
    } catch {
      feedback.textContent = t('common.communicationError');
      observer.observe(form);
    }
  }
  async function save() {
    saving = true;
    feedback.textContent = '';
    toggle.input.disabled = true;
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await window.extensionSettings.save(toggle.input.checked);
      if (!result.ok) feedback.textContent = locale.error(result.error);
      else await close();
    } catch {
      feedback.textContent = t('common.communicationError');
    } finally {
      saving = false;
      toggle.input.disabled = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      updateSize();
    }
  }
  root.append(dialog);
  settings.button.click();
  const form = dialog.querySelector('form')!;
  let lastHeight = 0;
  const updateSize = () => {
    if (!dialog.open) return;
    const height = Math.max(
      160,
      Math.ceil(form.getBoundingClientRect().height) + 2,
    );
    if (height === lastHeight) return;
    lastHeight = height;
    void window.extensionSettings
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
  void window.extensionSettings
    .get()
    .then((result) => {
      if (result.ok) {
        toggle.input.checked = result.value;
        toggle.input.disabled = false;
        saveButton.disabled = false;
        ready = true;
        dialog.querySelector('h2')!.focus({ preventScroll: true });
      } else feedback.textContent = locale.error(result.error);
      updateSize();
    })
    .catch(() => {
      feedback.textContent = t('common.communicationError');
      updateSize();
    });
}
