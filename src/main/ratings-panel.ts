import { ipcMain, nativeImage, WebContentsView } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { TubervaExtensions } from '../extensions/tuberva-extensions';
import type { RydPresentation } from '../extensions/return-youtube-dislike/presentation';
import { RATINGS_IPC, type RatingsSnapshot } from '../shared/ratings';
import { TOOLBAR_STYLE } from './toolbar-style';

// RYD owns its popup policy. The shared animator only receives presentation
// requests; it never reads a film ID, counters or a loading state.
export function createRatingsVisibility() {
  let allowed = false,
    version = 0;
  let lastVideo: string | null = null;
  let waitingForResult = false,
    autoUntil = 0;
  return {
    update(snapshot: RatingsSnapshot, permitted: boolean, now: number) {
      version = snapshot.version;
      const id = 'videoId' in snapshot ? snapshot.videoId : null;
      allowed = permitted && !!id;
      if (id && id !== lastVideo) {
        lastVideo = id;
        waitingForResult = allowed && snapshot.kind === 'loading';
        autoUntil = allowed ? now + 4000 : 0;
      } else if (waitingForResult && snapshot.kind !== 'loading') {
        waitingForResult = false;
        autoUntil = now + 4000;
      }
      if (!allowed) {
        waitingForResult = false;
        autoUntil = 0;
      }
    },
    request(
      now: number,
      dockVisible: boolean,
      hovered: boolean,
      blocked: boolean,
    ) {
      if (blocked) {
        waitingForResult = false;
        autoUntil = 0;
      } else if (hovered && !dockVisible && !waitingForResult)
        autoUntil = Math.max(autoUntil, now + 1600);
      return {
        allowed,
        version,
        visible:
          !blocked &&
          allowed &&
          (dockVisible || waitingForResult || now < autoUntil),
      };
    },
  };
}

export function createRatingsPanel(
  window: BrowserWindow,
  url: string,
  engine: TubervaExtensions,
  changed: () => void,
) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'ratings-preload.cjs'),
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  view.setBackgroundColor(TOOLBAR_STYLE.backgroundColor);
  view.setBackgroundBlur(TOOLBAR_STYLE.backgroundBlur);
  view.setBorderRadius(TOOLBAR_STYLE.borderRadius);
  view.setVisible(false);
  window.contentView.addChildView(view);
  let state: RatingsSnapshot = { version: 0, generation: 0, kind: 'no-video' };
  let source: ReturnType<TubervaExtensions['getService']> = null;
  let release = () => {};
  let closed = false;
  let allowed = false;
  const visibility = createRatingsVisibility();
  const publish = (next: RatingsSnapshot) => {
    state = { ...next, version: state.version + 1 };
    visibility.update(state, allowed, performance.now());
    if (!view.webContents.isDestroyed())
      view.webContents.send(RATINGS_IPC.changed, state);
    changed();
  };
  const refresh = () => {
    if (closed) return;
    const next = engine.getService('return-youtube-dislike');
    if (source === next) return;
    release();
    source = next;
    release = () => {};
    publish({ version: 0, generation: 0, kind: 'no-video' });
    if (!next) return;
    const service = next.value as RydPresentation;
    const unsubscribe = service.subscribe((value) => {
      if (source === next && !next.abort.signal.aborted) publish(value);
    });
    const revoke = () => {
      if (source === next) {
        release();
        source = null;
        publish({ version: 0, generation: 0, kind: 'no-video' });
      }
    };
    next.abort.signal.addEventListener('abort', revoke, { once: true });
    release = () => {
      unsubscribe();
      next.abort.signal.removeEventListener('abort', revoke);
    };
    publish(service.snapshot());
  };
  const authority = engine.onAuthorityChange(refresh);
  ipcMain.handle(RATINGS_IPC.get, (event, ...args) => {
    if (
      closed ||
      args.length ||
      event.sender !== view.webContents ||
      event.senderFrame !== view.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw Error('Untrusted ratings request.');
    return { ...state };
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, target) => {
    if (target !== url) event.preventDefault();
  });
  view.webContents.on('will-redirect', (event) => event.preventDefault());
  return {
    view,
    refresh,
    setAllowed(value: boolean) {
      allowed = value;
      visibility.update(state, allowed, performance.now());
    },
    presentation: visibility.request,
    layout(anchor: Electron.Rectangle) {
      const { width, height } = window.contentView.getBounds();
      const x = width - 240;
      view.setBounds({
        x,
        y: x >= anchor.x + anchor.width + 12 ? height - 88 : anchor.y - 80,
        width: 220,
        height: 68,
      });
    },
    async captureFrame(version: number) {
      // This is our own local document. Read its already-rendered canvas; a
      // hidden WebContentsView may not yet have a capturable compositor frame.
      const frame = await view.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.dataset.version === '${version}' ? canvas.toDataURL('image/png') : null;
      })()`);
      return typeof frame === 'string'
        ? nativeImage.createFromDataURL(frame)
        : null;
    },
    load: () => view.webContents.loadURL(url),
    dispose() {
      closed = true;
      release();
      void authority();
      ipcMain.removeHandler(RATINGS_IPC.get);
      // The parent is already closed here; its native hierarchy is being torn
      // down. Only close the child WebContents, as for the existing TV/dock.
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
