import { ImageView, nativeImage, screen, View } from 'electron';
import type { BrowserWindow, WebContentsView, NativeImage } from 'electron';
import { TOOLBAR_STYLE } from './toolbar-style';

export interface OverlayRequest {
  visible: boolean;
  allowed: boolean;
  version: number;
}
export interface OverlayFrame {
  now: number;
  pointer: { x: number; y: number };
  shown: number[];
  requested: boolean[];
  hovered: boolean[];
  blocked: boolean;
  failed: boolean;
}
export interface OverlaySurface {
  view: WebContentsView;
  captureFrame: (version: number) => Promise<NativeImage | null>;
  initiallyVisible?: boolean;
  clearOnVersionChange?: boolean;
  requireFrameBeforeMotion?: boolean;
  onReady?: () => void;
  beforeHide?: () => number;
}
const DURATION = 240;

// Participants own their data and visibility rules. The coordinator owns one
// animation clock, native presentation and one cursor monitor.
export function connectOverlayAnimation(
  window: BrowserWindow,
  participants: OverlaySurface[],
  requests: (frame: OverlayFrame) => OverlayRequest[],
  reportError: (message: string) => void,
) {
  const group = new View();
  group.setBackgroundColor('#00000000');
  group.setBackgroundBlur(0);
  group.setVisible(false);
  window.contentView.addChildView(group);
  const surfaces = participants.map((participant) => {
    const { view } = participant;
    const picture = new ImageView();
    picture.setBackgroundColor(TOOLBAR_STYLE.backgroundColor);
    picture.setBorderRadius(TOOLBAR_STYLE.borderRadius);
    picture.setBackgroundBlur(TOOLBAR_STYLE.backgroundBlur);
    picture.setVisible(false);
    group.addChildView(picture);
    return {
      view,
      participant,
      allowed: false,
      pendingFrameAt: null as number | null,
      picture,
      bounds: view.getBounds(),
      ready: false,
      version: 0,
      imageVersion: -1,
      hasImage: false,
      animating: false,
      shown: 0,
      from: 0,
      target: 0,
    };
  });
  let disposed = false;
  let failed = false;
  let capturing = false;
  let moving = false;
  let startedAt = 0;
  let travel = 0;
  let origin = { x: 0, y: 0 };
  let suppressed = false;

  function blocked() {
    return suppressed || !window.isVisible() || window.isMinimized();
  }
  function present() {
    if (failed) {
      group.setVisible(false);
      for (const surface of surfaces)
        surface.view.setVisible(surface.allowed && !blocked());
      return;
    }
    let rasterVisible = false;
    for (const surface of surfaces) {
      const visible = surface.shown > 0 && !blocked() && surface.allowed;
      // Keep glass on screen while the next version is being prepared.
      // a version change clears only the pixels, never the native surface.
      const raster =
        surface.animating ||
        (!!surface.participant.clearOnVersionChange &&
          surface.imageVersion !== surface.version);
      surface.picture.setVisible(visible && raster);
      surface.view.setVisible(visible && !raster);
      const b = surface.bounds;
      surface.picture.setBounds({
        ...b,
        x: b.x - origin.x,
        y: b.y - origin.y + Math.round((1 - surface.shown) * travel),
      });
      rasterVisible ||= visible && raster;
    }
    group.setVisible(rasterVisible);
  }
  function paint(now: number) {
    if (moving) {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / DURATION));
      const eased = 1 - (1 - progress) ** 3;
      for (const surface of surfaces) {
        if (surface.animating)
          surface.shown =
            surface.from + (surface.target - surface.from) * eased;
      }
      if (progress === 1) {
        moving = false;
        for (const surface of surfaces) surface.animating = false;
      }
    }
    present();
  }
  function hideImmediately(surface: (typeof surfaces)[number]) {
    surface.shown = surface.from = surface.target = 0;
    surface.animating = false;
    surface.view.setVisible(false);
    surface.picture.setVisible(false);
  }
  function layout() {
    if (disposed) return;
    paint(performance.now());
    const { height } = window.contentView.getBounds();
    for (const surface of surfaces) {
      surface.bounds = surface.view.getBounds();
      surface.imageVersion = -1;
    }
    const bounds = surfaces.map((s) => s.bounds);
    origin = {
      x: Math.min(...bounds.map((b) => b.x)),
      y: Math.min(...bounds.map((b) => b.y)),
    };
    travel = height - origin.y;
    group.setBounds({
      ...origin,
      width: Math.max(...bounds.map((b) => b.x + b.width)) - origin.x,
      height: travel,
    });
    // A resize changes coordinates, not animation time or direction.
    paint(performance.now());
  }
  function fail(cause: unknown) {
    failed = true;
    moving = false;
    group.setVisible(false);
    for (const surface of surfaces) surface.picture.setVisible(false);
    for (const surface of surfaces)
      surface.view.setVisible(surface.allowed && !blocked());
    reportError(
      `Overlay animation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  async function prepare() {
    if (capturing || disposed || failed || blocked()) return;
    const needed = surfaces.filter(
      (s) =>
        s.ready &&
        (s.participant.clearOnVersionChange
          ? s.shown > 0 || s.target > 0
          : s.shown !== s.target || s.animating) &&
        s.imageVersion !== s.version,
    );
    if (!needed.length) return;
    capturing = true;
    let waitingForFrame = false;
    try {
      for (const surface of needed) {
        const version = surface.version;
        const image = await surface.participant.captureFrame(version);
        if (disposed || version !== surface.version || blocked()) continue;
        if (!image) {
          surface.pendingFrameAt ??= performance.now();
          if (performance.now() - surface.pendingFrameAt > 2000)
            throw Error('Overlay frame did not become ready.');
          waitingForFrame = true;
          continue;
        }
        surface.pendingFrameAt = null;
        if (image.isEmpty()) throw Error('An overlay frame is empty.');
        surface.picture.setImage(image);
        surface.imageVersion = version;
        surface.hasImage = true;
      }
    } catch (cause) {
      if (!disposed && !blocked()) fail(cause);
    } finally {
      capturing = false;
      if (!disposed && !waitingForFrame) update();
    }
  }
  function animate(now: number) {
    if (failed) return;
    void prepare();
    if (!moving && !surfaces.some((s) => s.shown !== s.target)) return;
    const active = surfaces.filter((s) => s.shown !== s.target);
    if (
      active.some(
        (s) =>
          !s.ready || (s.participant.requireFrameBeforeMotion && !s.hasImage),
      )
    ) {
      void prepare();
      return;
    }
    if (moving || !active.some((s) => s.shown !== s.target)) return;
    for (const surface of surfaces) {
      surface.from = surface.shown;
      surface.animating = surface.shown !== surface.target;
      if (surface.animating) surface.view.setVisible(false);
      surface.picture.setVisible(
        surface.animating && !!(surface.shown || surface.target),
      );
    }
    startedAt = now;
    moving = true;
    group.setVisible(true);
    paint(now);
  }
  function retarget(targets: number[], now: number) {
    if (surfaces.some((s, i) => s.target !== targets[i])) {
      paint(now);
      moving = false;
      for (const [i, surface] of surfaces.entries()) {
        if (surface.target !== targets[i] && !targets[i])
          surface.version =
            surface.participant.beforeHide?.() ?? surface.version;
        surface.target = targets[i];
      }
    }
    animate(now);
  }
  function update() {
    if (disposed) return;
    const now = performance.now();
    const cursor = screen.getCursorScreenPoint();
    const content = window.getContentBounds();
    const pointer = { x: cursor.x - content.x, y: cursor.y - content.y };
    const next = requests({
      now,
      pointer,
      shown: surfaces.map((s) => s.shown),
      requested: surfaces.map((s) => !!s.target),
      hovered: surfaces.map((s) => {
        const b = s.bounds;
        return (
          s.allowed &&
          s.shown > 0 &&
          pointer.x >= b.x &&
          pointer.x < b.x + b.width &&
          pointer.y >= b.y &&
          pointer.y < b.y + b.height
        );
      }),
      blocked: blocked(),
      failed,
    });
    for (const [i, surface] of surfaces.entries()) {
      const state = next[i];
      surface.allowed = state.allowed;
      if (surface.version !== state.version) {
        surface.pendingFrameAt = null;
        surface.version = state.version;
        if (surface.participant.clearOnVersionChange)
          surface.picture.setImage(nativeImage.createEmpty());
      }
      if (!state.allowed) hideImmediately(surface);
    }
    paint(now);
    if (blocked()) {
      moving = false;
      group.setVisible(false);
      for (const surface of surfaces) hideImmediately(surface);
      return;
    }
    retarget(
      next.map((state) => Number(state.allowed && state.visible)),
      now,
    );
  }
  const readyHandlers = surfaces.map((surface) => {
    const onReady = () => {
      surface.ready = true;
      surface.imageVersion = -1;
      surface.participant.onReady?.();
      if (surface.participant.initiallyVisible)
        surface.shown = surface.target = 1;
      update();
    };
    surface.view.webContents.on('did-finish-load', onReady);
    return onReady;
  });
  layout();
  const monitor = setInterval(update, 16);
  return {
    layout,
    refresh: update,
    setSuppressed(value: boolean) {
      suppressed = value;
      update();
    },
    dispose() {
      disposed = true;
      clearInterval(monitor);
      for (const [i, surface] of surfaces.entries()) {
        surface.view.webContents.removeListener(
          'did-finish-load',
          readyHandlers[i],
        );
      }
    },
  };
}
