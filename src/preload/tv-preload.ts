import { ipcRenderer } from 'electron';
import { IPC } from '../shared/api';

// This isolated preload exposes no application API to YouTube.
let composing = false;
document.addEventListener(
  'compositionstart',
  () => {
    composing = true;
  },
  true,
);
document.addEventListener(
  'compositionend',
  () => {
    composing = false;
  },
  true,
);

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest('input, textarea, [role="textbox"]'))
  );
}

function editing() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return composing || editable(active);
}

function requestBack() {
  if (!editing()) ipcRenderer.send(IPC.dispatchTVBack);
}

document.addEventListener(
  'contextmenu',
  (event) => {
    if (!event.isTrusted || editing() || event.composedPath().some(editable))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestBack();
  },
  true,
);

// Toolbar requests still pass through the actual document's IME/focus guard.
ipcRenderer.on(IPC.requestTVBack, requestBack);
