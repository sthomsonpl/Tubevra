import { ImageView, screen, View } from 'electron';
import type { BrowserWindow, WebContentsView } from 'electron';
import { TOOLBAR_STYLE } from './toolbar-style';

const WIDTH = 300;
const HEIGHT = 68;
const GAP = 20;
const TRAVEL = HEIGHT + GAP;
const DURATION = 240;
const HIDE_DELAY = 1600;
const TRIGGER_HEIGHT = 64;

// WebContentsView's native animation moves its background ahead of its embedded
// page. Animate one rasterized copy of the original controls instead, with the
// same live native glass underneath. The real buttons take over at rest.
export function connectToolbarAutoHide(
  window: BrowserWindow,
  toolbar: WebContentsView,
  restoreFocus: () => void,
  reportError: (message: string) => void,
) {
  const group = new View();
  group.setBackgroundColor('#00000000');
  // Give the animation its own compositor coordinate space. Animating a root
  // layer directly can include the native menu offset and jump at completion.
  group.setBackgroundBlur(0);
  const picture = new ImageView();
  picture.setBackgroundColor(TOOLBAR_STYLE.backgroundColor);
  picture.setBorderRadius(TOOLBAR_STYLE.borderRadius);
  picture.setBackgroundBlur(TOOLBAR_STYLE.backgroundBlur);
  picture.setBounds({ x: 0, y: TRAVEL, width: WIDTH, height: HEIGHT });
  group.addChildView(picture);
  group.setVisible(false);
  window.contentView.addChildView(group);

  let ready = false;
  let disposed = false;
  let failed = false;
  let desired = true;
  let live = true;
  let hasImage = false;
  let moving = false;
  let preparing = false;
  let revision = 0;
  let completesAt = 0;
  let outsideSince: number | null = null;
  let pinned = false;
  let suppressed = false;
  let keyboardFocus = false;

  function layout() {
    const { width, height } = window.contentView.getBounds();
    const bounds = {
      x: Math.round((width - WIDTH) / 2),
      y: height - TRAVEL,
      width: WIDTH,
      height: HEIGHT,
    };
    toolbar.setBounds(bounds);
    group.setBounds({ ...bounds, height: TRAVEL });
  }

  function settle() {
    preparing = false;
    moving = false;
    live = desired;
    toolbar.setVisible(live && !suppressed);
    group.setVisible(false);
  }

  async function transition(next: boolean, immediate = false) {
    if (desired === next && (!immediate || (!moving && !preparing))) return;
    desired = next;
    const current = ++revision;
    outsideSince = null;
    if (!next && toolbar.webContents.isFocused()) restoreFocus();
    if (immediate || failed) {
      preparing = false;
      moving = false;
      group.setVisible(false);
      picture.setBounds(
        { x: 0, y: next ? 0 : TRAVEL, width: WIDTH, height: HEIGHT },
        { animate: { duration: 0 } },
      );
      settle();
      return;
    }
    if (!ready) return;
    if (next && !hasImage) {
      settle();
      return;
    }
    // A reversal reuses the same complete frame and retargets the native layer
    // from its current position; it never restarts from either end.
    if (!moving && live) {
      preparing = true;
      try {
        const image = await toolbar.webContents.capturePage();
        if (disposed || revision !== current) return;
        if (image.isEmpty()) throw Error('The toolbar frame is empty.');
        picture.setImage(image);
        hasImage = true;
      } catch (cause) {
        if (disposed || revision !== current) return;
        failed = true;
        desired = true;
        settle();
        reportError(
          `Dock animation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return;
      } finally {
        if (revision === current) preparing = false;
      }
    }
    if (disposed || revision !== current) return;
    if (!moving)
      picture.setBounds({
        x: 0,
        y: live ? 0 : TRAVEL,
        width: WIDTH,
        height: HEIGHT,
      });
    toolbar.setVisible(false);
    group.setVisible(true);
    moving = true;
    completesAt = performance.now() + DURATION;
    picture.setBounds(
      { x: 0, y: next ? 0 : TRAVEL, width: WIDTH, height: HEIGHT },
      { animate: { duration: DURATION, easing: 'ease-out' } },
    );
  }

  function update() {
    if (disposed) return;
    if (
      moving &&
      performance.now() >= completesAt &&
      picture.getBounds().y === (desired ? 0 : TRAVEL)
    )
      settle();
    if (suppressed || !window.isVisible() || window.isMinimized()) {
      void transition(false, true);
      return;
    }
    if (pinned || failed) {
      void transition(true);
      return;
    }
    let hovered = false;
    if (window.isFocused()) {
      const cursor = screen.getCursorScreenPoint();
      const content = window.getContentBounds();
      const { width, height } = window.contentView.getBounds();
      const x = cursor.x - content.x;
      const y = cursor.y - content.y;
      hovered =
        x >= 0 &&
        x < width &&
        y < height &&
        (y >= height - TRIGGER_HEIGHT ||
          ((live || moving) &&
            Math.abs(x - width / 2) < WIDTH / 2 + 30 &&
            y >= height - TRAVEL - 8));
    }
    if (hovered || (window.isFocused() && keyboardFocus)) {
      outsideSince = null;
      void transition(true);
    } else if (desired) {
      outsideSince ??= performance.now();
      if (performance.now() - outsideSince >= HIDE_DELAY)
        void transition(false);
    }
  }

  const onKey = (_event: Electron.Event, input: Electron.Input) => {
    if (input.type === 'keyDown') {
      keyboardFocus = true;
      update();
    }
  };
  const onMouse = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
    if (input.type === 'mouseDown') keyboardFocus = false;
  };
  const onBlur = () => {
    keyboardFocus = false;
  };
  const onReady = () => {
    ready = true;
    // Start with the original live toolbar. Capture it only after it has been
    // presented; a never-presented hidden WebContents can return an empty image.
    desired = live = true;
    toolbar.setVisible(!suppressed);
    outsideSince = null;
    update();
  };
  toolbar.webContents.on('did-finish-load', onReady);
  toolbar.webContents.on('before-input-event', onKey);
  toolbar.webContents.on('before-mouse-event', onMouse);
  toolbar.webContents.on('blur', onBlur);
  layout();
  const monitor = setInterval(update, 16);

  return {
    layout,
    setState(state: { pinned: boolean; suppressed: boolean }) {
      pinned = state.pinned;
      suppressed = state.suppressed;
      update();
    },
    dispose() {
      disposed = true;
      revision++;
      clearInterval(monitor);
      toolbar.webContents.removeListener('did-finish-load', onReady);
      toolbar.webContents.removeListener('before-input-event', onKey);
      toolbar.webContents.removeListener('before-mouse-event', onMouse);
      toolbar.webContents.removeListener('blur', onBlur);
    },
  };
}
