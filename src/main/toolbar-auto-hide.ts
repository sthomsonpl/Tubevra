import type { BrowserWindow, WebContentsView } from 'electron';

const WIDTH = 400,
  HEIGHT = 68,
  GAP = 20;
const HIDE_DELAY = 1600,
  TRIGGER_HEIGHT = 64;

// Dock policy only: no ratings, raster images or animation clock.
export function createToolbarAutoHide(
  window: BrowserWindow,
  toolbar: WebContentsView,
  restoreFocus: () => void,
  changed: () => void,
) {
  let outsideSince: number | null = null;
  let pinned = false,
    keyboardFocus = false,
    version = 0;
  const onKey = (_event: Electron.Event, input: Electron.Input) => {
    if (input.type === 'keyDown') {
      keyboardFocus = true;
      changed();
    }
  };
  const onMouse = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
    if (input.type === 'mouseDown') keyboardFocus = false;
  };
  const onBlur = () => {
    keyboardFocus = false;
  };
  toolbar.webContents.on('before-input-event', onKey);
  toolbar.webContents.on('before-mouse-event', onMouse);
  toolbar.webContents.on('blur', onBlur);
  return {
    version: () => version,
    onReady() {
      version++;
      outsideSince = null;
    },
    beforeHide() {
      if (toolbar.getVisible()) version++;
      if (window.isFocused() && toolbar.webContents.isFocused()) restoreFocus();
      return version;
    },
    layout() {
      const { width, height } = window.contentView.getBounds();
      toolbar.setBounds({
        x: Math.round((width - WIDTH) / 2),
        y: height - HEIGHT - GAP,
        width: WIDTH,
        height: HEIGHT,
      });
    },
    request(
      now: number,
      pointer: { x: number; y: number },
      shown: number,
      requested: boolean,
      companionHovered: boolean,
      failed = false,
    ) {
      const { width, height } = window.contentView.getBounds();
      const { x, y } = pointer;
      const hover =
        x >= 0 &&
        x < width &&
        y < height &&
        (y >= height - TRIGGER_HEIGHT ||
          (shown > 0 &&
            Math.abs(x - width / 2) < WIDTH / 2 + 30 &&
            y >= height - HEIGHT - GAP - 8) ||
          (requested && companionHovered));
      if (pinned || failed || hover || (window.isFocused() && keyboardFocus)) {
        outsideSince = null;
        return true;
      }
      if (!requested) return false;
      outsideSince ??= now;
      return now - outsideSince < HIDE_DELAY;
    },
    setPinned(value: boolean) {
      pinned = value;
      changed();
    },
    dispose() {
      toolbar.webContents.removeListener('before-input-event', onKey);
      toolbar.webContents.removeListener('before-mouse-event', onMouse);
      toolbar.webContents.removeListener('blur', onBlur);
    },
  };
}
