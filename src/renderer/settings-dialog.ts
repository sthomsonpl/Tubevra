let dialogId = 0;

export function createSettingsDialog(
  title: string,
  content: HTMLElement,
  actions: {
    onOpen: () => void;
    onSave: () => void;
    onCancel?: () => void;
    saveLabel?: string;
  },
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const header = document.createElement('header');
  header.className = 'settings-dialog-header';
  const heading = document.createElement('h2');
  heading.id = `settings-dialog-${++dialogId}`;
  heading.tabIndex = -1;
  heading.autofocus = true;
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  const subtitle = document.createElement('p');
  subtitle.className = 'heading-subtitle';
  subtitle.textContent = 'Add-on settings';
  header.append(heading, subtitle);
  const footer = document.createElement('div');
  footer.className = 'settings-dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () =>
    actions.onCancel ? actions.onCancel() : dialog.close(),
  );
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = actions.saveLabel ?? 'Save settings';
  form.addEventListener('submit', () => actions.onSave());
  footer.append(cancel, save);
  form.append(header, content, footer);
  dialog.append(form);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary compact-btn';
  button.textContent = 'Settings';
  button.setAttribute('aria-label', `Settings for ${title}`);
  button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', () => {
    actions.onOpen();
    dialog.showModal();
  });
  return { button, dialog };
}
