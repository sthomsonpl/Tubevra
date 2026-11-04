import { createSettingsDialog } from '../settings-dialog';
import { createWidgetRow, createWidgetToggle } from '../widgets';

export function mountRydSettings(root: HTMLElement) {
  document.body.className = 'settings-page glass-active extension-options-page';
  const content = document.createElement('div');
  content.className = 'settings-dialog-content';
  const box = document.createElement('div');
  box.className = 'widget-box';
  const option = createWidgetRow(
    'Show with dock',
    'When disabled, ratings appear only after a video change.',
  );
  const toggle = createWidgetToggle('Show with dock', false);
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
  const settings = createSettingsDialog('Return YouTube Dislike', content, {
    onOpen() {},
    onCancel() {
      if (!saving) void close();
    },
    onSave() {
      if (ready && !saving) void save();
    },
  });
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
        feedback.textContent = result.error;
        observer.observe(form);
      } else dialog.close();
    } catch {
      feedback.textContent = 'Cannot communicate with Tubevra.';
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
      if (!result.ok) feedback.textContent = result.error;
      else await close();
    } catch {
      feedback.textContent = 'Cannot communicate with Tubevra.';
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
        if (!result.ok && dialog.open) feedback.textContent = result.error;
      })
      .catch(() => {
        if (dialog.open)
          feedback.textContent = 'Cannot resize extension settings.';
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
      } else feedback.textContent = result.error;
      updateSize();
    })
    .catch(() => {
      feedback.textContent = 'Cannot communicate with Tubevra.';
      updateSize();
    });
}
