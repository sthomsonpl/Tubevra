import type { ExtensionsState } from '../../extensions/types';

export function mountExtensions(root: HTMLElement) {
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const list = document.createElement('div');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'secondary';
  reload.textContent = 'Reload YouTube TV';
  reload.hidden = true;
  root.append(feedback, list, reload);
  let current: ExtensionsState | null = null;
  let busy = false;
  let operationError = '';
  const labels = {
    disabled: 'Disabled',
    starting: 'Starting…',
    active: 'Active',
    error: 'Error',
  };
  function render(state: ExtensionsState) {
    if (current && state.revision < current.revision) return;
    current = state;
    list.replaceChildren();
    reload.hidden = !state.items.some((item) => item.reloadRequired);
    reload.disabled = busy;
    feedback.textContent = [state.error, operationError]
      .filter(Boolean)
      .join(' ');
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No add-ons are available yet.';
      list.append(empty);
    }
    for (const item of state.items) {
      const row = document.createElement('div');
      row.className = 'widget-box widget-row';
      const copy = document.createElement('div');
      copy.className = 'row-copy';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const description = document.createElement('p');
      description.textContent = item.description;
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = [
        `Runtime: ${labels[item.status]}`,
        item.enabled && item.status === 'disabled' && item.reloadRequired
          ? 'Enabled in settings. Starts after reload.'
          : null,
        item.error,
        item.reloadRequired
          ? `Reload required: ${item.reloadReason ?? 'New document required.'}`
          : null,
      ]
        .filter(Boolean)
        .join(': ');
      const label = document.createElement('label');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = item.enabled;
      toggle.disabled = busy || !item.modes.includes('tv');
      toggle.setAttribute('aria-label', `Enable ${item.name}`);
      label.append(toggle, ' Enabled');
      toggle.addEventListener('change', async () => {
        const enabled = toggle.checked;
        busy = true;
        operationError = '';
        render(current!);
        try {
          const result = await window.tubevra.setExtensionEnabled({
            id: item.id,
            enabled,
          });
          if (result.ok) render(result.value);
          else operationError = result.error;
        } catch {
          operationError = 'Cannot communicate with Tubevra.';
        } finally {
          busy = false;
          render(current!);
        }
      });
      copy.append(name, description, status);
      row.append(copy, label);
      list.append(row);
    }
  }
  reload.addEventListener('click', async () => {
    busy = true;
    operationError = '';
    render(current!);
    try {
      const result = await window.tubevra.reloadTV();
      if (!result.ok) operationError = result.error;
    } catch {
      operationError = 'Cannot communicate with Tubevra.';
    } finally {
      busy = false;
      render(current!);
    }
  });
  window.tubevra.onExtensionsStateChanged(render);
  void window.tubevra
    .getExtensions()
    .then((result) => {
      if (result.ok) render(result.value);
      else feedback.textContent = result.error;
    })
    .catch(() => {
      feedback.textContent = 'Cannot communicate with Tubevra.';
    });
  return { render };
}
