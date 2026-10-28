import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  shell,
  WebContentsView,
} from 'electron';
import { starts as mainStarts } from '../extensions/main/implementations';
import { TubervaExtensions } from '../extensions/tuberva-extensions';
import { connectPage } from '../extensions/main/page-bridge';
import { extensionRegistry, hookManifest } from '../extensions/registry';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IPC,
  PROJECT_GITHUB_URL,
  PRIVACY_POLICY_URL,
  SPONSORBLOCK_URL,
  RYD_URL,
} from '../shared/api';
import type { AppState, Result } from '../shared/api';
import type { UserAgentStore } from './user-agent-store';
import { GeneralSettingsStore } from './general-settings-store';
import { selectTVDisplay } from './tv-display';
import { connectTVDisplay } from './tv-display-bridge';
import { createToolbarAutoHide } from './toolbar-auto-hide';
import { connectOverlayAnimation } from './overlay-animation';
import { TOOLBAR_STYLE } from './toolbar-style';
import { createRatingsPanel } from './ratings-panel';

const TV_HOME = 'https://www.youtube.com/tv';

function isTVURL(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://www.youtube.com' &&
      (url.pathname === '/tv' || url.pathname.startsWith('/tv/'))
    );
  } catch {
    return false;
  }
}

export async function createTVWindow(
  store: UserAgentStore,
  general = GeneralSettingsStore.open(app.getPath('userData')),
) {
  const display = selectTVDisplay(
    screen.getAllDisplays(),
    screen.getPrimaryDisplay().id,
  );
  const shellURL = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href
    : pathToFileURL(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      ).href;
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 540,
    icon: path.join(app.getAppPath(), 'assets', 'icon', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const tvSession = session.fromPartition('persist:tubevra-tv');
  // Prepare persistence and the single network owner before creating/loading TV.
  let extensions: TubervaExtensions;
  let notifyExtensions = () => {};
  try {
    extensions = await TubervaExtensions.open(
      app.getPath('userData'),
      extensionRegistry,
      tvSession.webRequest,
      mainStarts,
      () => notifyExtensions(),
      hookManifest,
    );
  } catch (cause) {
    mainWindow.destroy();
    throw cause;
  }
  tvSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'fullscreen' && isTVURL(contents.getURL()));
  });
  tvSession.setPermissionCheckHandler((contents, permission) => {
    return (
      permission === 'fullscreen' && !!contents && isTVURL(contents.getURL())
    );
  });
  const youtube = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tv-preload.cjs'),
      session: tvSession,
      // Keep playback active when the window is minimized or covered.
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  const contents = youtube.webContents;
  youtube.setVisible(false);
  contents.setUserAgent(store.activeUserAgent());
  mainWindow.contentView.addChildView(youtube);
  // Local DOM z-index cannot rise above a sibling native view. Keep the local
  // overlay in its own small surface so the rest of YouTube receives input.
  const toolbarURL = `${shellURL}#toolbar`;
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  toolbar.setBackgroundColor(TOOLBAR_STYLE.backgroundColor);
  toolbar.setBorderRadius(TOOLBAR_STYLE.borderRadius);
  toolbar.setBackgroundBlur(TOOLBAR_STYLE.backgroundBlur);
  mainWindow.contentView.addChildView(toolbar);
  let updateRatings = () => {};
  const ratings = createRatingsPanel(
    mainWindow,
    shellURL + '#ratings',
    extensions,
    () => updateRatings(),
  );
  for (const surface of [
    mainWindow.webContents,
    contents,
    toolbar.webContents,
    ratings.view.webContents,
  ]) {
    surface.on('before-input-event', (event, input) => {
      if (
        input.type !== 'keyDown' ||
        input.key !== 'F11' ||
        input.isComposing ||
        input.control ||
        input.alt ||
        input.shift ||
        input.meta
      )
        return;

      event.preventDefault();
      if (!input.isAutoRepeat) {
        void toggleFullscreen().catch((cause) => reportError(cause.message));
      }
    });
  }
  let refreshOverlays = () => {};
  const dock = createToolbarAutoHide(
    mainWindow,
    toolbar,
    () => {
      if (settingsOpen || error || loading) mainWindow.webContents.focus();
      else contents.focus();
    },
    () => refreshOverlays(),
  );
  const overlays = connectOverlayAnimation(
    mainWindow,
    [
      {
        view: toolbar,
        captureFrame: () => toolbar.webContents.capturePage(),
        initiallyVisible: true,
        requireFrameBeforeMotion: true,
        onReady: dock.onReady,
        beforeHide: dock.beforeHide,
      },
      {
        view: ratings.view,
        captureFrame: ratings.captureFrame,
        clearOnVersionChange: true,
      },
    ],
    (frame) => {
      const visible =
        !frame.blocked &&
        dock.request(
          frame.now,
          frame.pointer,
          frame.shown[0],
          frame.requested[0],
          frame.hovered[1],
          frame.failed,
        );
      return [
        { visible, allowed: true, version: dock.version() },
        ratings.presentation(
          frame.now,
          visible,
          frame.hovered[1],
          frame.blocked,
        ),
      ];
    },
    (message) => reportError(message),
  );
  refreshOverlays = overlays.refresh;
  const resize = () => {
    const { width, height } = mainWindow.contentView.getBounds();
    youtube.setBounds({ x: 0, y: 0, width, height });
    dock.layout();
    ratings.layout(toolbar.getBounds());
    overlays.layout();
    updateRatings();
  };
  resize();
  // The root view also changes when the native menu is first laid out. Window
  // resize alone can leave child bounds based on the earlier client height.
  mainWindow.contentView.on('bounds-changed', resize);

  let error: string | null = null;
  let playbackFullscreen = false;
  let settingsOpen = false;
  let loading = true;
  updateRatings = () => {
    if (mainWindow.isDestroyed()) return;
    const allowed =
      !settingsOpen &&
      !error &&
      !loading &&
      !playbackFullscreen &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized();
    ratings.setAllowed(allowed);
    overlays.refresh();
  };
  ratings.view.webContents.on('focus', () => {
    if (mainWindow.isFocused() && !settingsOpen && !loading && !error)
      contents.focus();
  });
  ratings.view.webContents.on('before-mouse-event', (event, input) => {
    if (
      input.type === 'mouseDown' &&
      input.button === 'right' &&
      mainWindow.isFocused() &&
      !settingsOpen
    ) {
      event.preventDefault();
      contents.send(IPC.requestTVBack);
    }
  });
  ratings.refresh();
  const state = (): AppState => ({
    version: app.getVersion(),
    general: general.snapshot(),
    mode: 'tv',
    extensions: extensions.snapshot(),
    userAgents: store.snapshot(),
    playbackFullscreen,
    windowFullscreen: mainWindow.isFullScreen(),
    settingsOpen,
    loading,
    error,
  });
  const publish = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.stateChanged, state());
      if (!toolbar.webContents.isDestroyed())
        toolbar.webContents.send(IPC.stateChanged, state());
    }
  };
  const syncVisibility = () => {
    // Extension errors are separate from YouTube load errors.
    if (mainWindow.isDestroyed()) return;
    youtube.setVisible(!settingsOpen && !error && !loading);
    updateRatings();
    dock.setPinned(settingsOpen || !!error || loading);
    overlays.setSuppressed(playbackFullscreen);
  };
  const pageBridge = connectPage(ipcMain, contents, extensions);
  notifyExtensions = () => {
    ratings.refresh();
    publish();
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send(
        IPC.extensionsStateChanged,
        extensions.snapshot(),
      );
    pageBridge.publish();
  };
  const reportError = (message: string) => {
    error = message;
    if (mainWindow.isDestroyed()) return;
    loading = false;
    syncVisibility();
    publish();
  };
  mainWindow.on('enter-full-screen', publish);
  mainWindow.on('leave-full-screen', publish);

  let fullscreenTransition: Promise<void> | null = null;
  function toggleFullscreen(): Promise<void> {
    // F11 and the dock share one in-flight native transition, including on macOS.
    if (fullscreenTransition) return fullscreenTransition;
    const target = !mainWindow.isFullScreen();
    const transition = new Promise<void>((resolve, reject) => {
      const completed = () => {
        if (mainWindow.isFullScreen() !== target) return;
        clear();
        resolve();
      };
      const closed = () => {
        clear();
        reject(
          new Error('The window closed during the fullscreen transition.'),
        );
      };
      const clear = () => {
        clearTimeout(timeout);
        mainWindow.removeListener('enter-full-screen', completed);
        mainWindow.removeListener('leave-full-screen', completed);
        mainWindow.removeListener('closed', closed);
      };
      const timeout = setTimeout(() => {
        clear();
        reject(new Error('The fullscreen transition did not complete.'));
      }, 10000);
      mainWindow.on('enter-full-screen', completed);
      mainWindow.on('leave-full-screen', completed);
      mainWindow.once('closed', closed);
      try {
        mainWindow.setFullScreen(target);
      } catch (cause) {
        clear();
        reject(cause);
      }
    });
    fullscreenTransition = transition.finally(() => {
      fullscreenTransition = null;
    });
    return fullscreenTransition;
  }
  const displayBridge = connectTVDisplay(
    ipcMain,
    contents,
    display,
    reportError,
  );

  function assertShell(event: IpcMainInvokeEvent) {
    const sender = event.sender;
    const expectedURL =
      sender === mainWindow.webContents
        ? shellURL
        : sender === toolbar.webContents
          ? toolbarURL
          : null;
    if (
      mainWindow.isDestroyed() ||
      !expectedURL ||
      event.senderFrame !== sender.mainFrame ||
      event.senderFrame.url !== expectedURL
    ) {
      throw new Error('Untrusted IPC sender.');
    }
  }

  const loadTV = async (url: string, reload = false) => {
    error = null;
    loading = true;
    syncVisibility();
    publish();
    try {
      if (reload) {
        // loadURL can perform only a same-document navigation for a hash route.
        // Hooks need a new document; reload retains the current URL, UA and session.
        await new Promise<void>((resolve, reject) => {
          const clear = () => {
            contents.removeListener('did-finish-load', finished);
            contents.removeListener('did-fail-load', failed);
            contents.removeListener('destroyed', destroyed);
          };
          const finished = () => {
            clear();
            resolve();
          };
          const destroyed = () => {
            clear();
            reject(new Error('YouTube view closed during reload.'));
          };
          const failed = (
            _event: Electron.Event,
            _code: number,
            description: string,
            _url: string,
            mainFrame: boolean,
          ) => {
            if (mainFrame) {
              clear();
              reject(new Error(description));
            }
          };
          contents.once('did-finish-load', finished);
          contents.on('did-fail-load', failed);
          contents.once('destroyed', destroyed);
          contents.reload();
        });
      } else {
        await contents.loadURL(url, { userAgent: store.activeUserAgent() });
      }
      if (error) throw new Error(error);
      if (mainWindow.isDestroyed()) return;
      loading = false;
      syncVisibility();
      if (!settingsOpen) contents.focus();
      publish();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'YouTube failed to load.';
      reportError(message);
      throw new Error(message);
    }
  };

  // Keep persistence and navigation in one queue: concurrent IPC must not apply
  // an older UA after a newer selection has already been saved.
  let pending: Promise<unknown> = Promise.resolve();
  const handle = (
    channel: string,
    action: (...args: unknown[]) => Promise<void> | void,
  ) => {
    ipcMain.handle(channel, (event, ...args): Promise<Result<AppState>> => {
      assertShell(event);
      const operation = pending.then(async (): Promise<Result<AppState>> => {
        try {
          if (mainWindow.isDestroyed())
            throw new Error('The window was closed.');
          await action(...args);
          return { ok: true, value: state() };
        } catch (cause) {
          return {
            ok: false,
            error: cause instanceof Error ? cause.message : 'Operation failed.',
          };
        }
      });
      pending = operation.catch(() => {});
      return operation;
    });
  };
  ipcMain.handle(IPC.getState, (event, ...args): Result<AppState> => {
    assertShell(event);
    if (args.length) return { ok: false, error: 'Unexpected arguments.' };
    return { ok: true, value: state() };
  });
  ipcMain.handle(
    IPC.toggleFullscreen,
    async (event, ...args): Promise<Result<AppState>> => {
      assertShell(event);
      if (args.length) return { ok: false, error: 'Unexpected arguments.' };
      try {
        await toggleFullscreen();
        return { ok: true, value: state() };
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Fullscreen failed.';
        reportError(message);
        return { ok: false, error: message };
      }
    },
  );
  ipcMain.handle(
    IPC.openProjectGitHub,
    async (event, ...args): Promise<Result<null>> => {
      assertShell(event);
      if (args.length) return { ok: false, error: 'Unexpected arguments.' };
      try {
        await shell.openExternal(PROJECT_GITHUB_URL);
        return { ok: true, value: null };
      } catch (cause) {
        return {
          ok: false,
          error:
            cause instanceof Error ? cause.message : 'Could not open GitHub.',
        };
      }
    },
  );
  ipcMain.handle(
    IPC.openPrivacyPolicy,
    async (event, ...args): Promise<Result<null>> => {
      assertShell(event);
      if (args.length) return { ok: false, error: 'Unexpected arguments.' };
      try {
        await shell.openExternal(PRIVACY_POLICY_URL);
        return { ok: true, value: null };
      } catch (cause) {
        return {
          ok: false,
          error:
            cause instanceof Error
              ? cause.message
              : 'Could not open Privacy Policy.',
        };
      }
    },
  );
  ipcMain.handle(
    IPC.openSponsorBlock,
    async (event, ...args): Promise<Result<null>> => {
      assertShell(event);
      if (args.length) return { ok: false, error: 'Unexpected arguments.' };
      try {
        await shell.openExternal(SPONSORBLOCK_URL);
        return { ok: true, value: null };
      } catch {
        return { ok: false, error: 'Could not open SponsorBlock.' };
      }
    },
  );
  ipcMain.handle(
    IPC.openReturnYouTubeDislike,
    async (event, ...args): Promise<Result<null>> => {
      assertShell(event);
      if (args.length) return { ok: false, error: 'Unexpected arguments.' };
      try {
        await shell.openExternal(RYD_URL);
        return { ok: true, value: null };
      } catch {
        return { ok: false, error: 'Could not open Return YouTube Dislike.' };
      }
    },
  );
  ipcMain.handle(IPC.getExtensions, (event, ...args) => {
    assertShell(event);
    return args.length
      ? { ok: false, error: 'Unexpected arguments.' }
      : { ok: true, value: extensions.snapshot() };
  });
  ipcMain.handle(IPC.setExtensionEnabled, async (event, ...args) => {
    assertShell(event);
    try {
      if (args.length !== 1)
        throw new Error('Expected one extension operation.');
      return { ok: true, value: await extensions.update(args[0]) };
    } catch (cause) {
      return {
        ok: false,
        error:
          cause instanceof Error
            ? cause.message
            : 'Extension operation failed.',
      };
    }
  });
  handle(IPC.setHardwareAcceleration, async (...args) => {
    if (args.length !== 1)
      throw new Error('Expected one hardware acceleration flag.');
    await general.setHardwareAcceleration(args[0]);
    publish();
  });
  handle(IPC.restartApp, (...args) => {
    if (args.length) throw new Error('Unexpected arguments.');
    if (!general.snapshot().restartRequired)
      throw new Error('No general settings require a restart.');
    app.relaunch();
    app.quit();
  });
  handle(IPC.reloadTV, async (...args) => {
    if (args.length) throw new Error('Unexpected arguments.');
    const url = contents.getURL();
    await loadTV(isTVURL(url) ? url : TV_HOME, isTVURL(url));
  });
  ipcMain.handle(IPC.setSettingsOpen, (event, ...args): Result<AppState> => {
    assertShell(event);
    if (args.length !== 1 || typeof args[0] !== 'boolean')
      return { ok: false, error: 'Expected a settings visibility flag.' };
    if (args[0] && playbackFullscreen)
      return {
        ok: false,
        error: 'Leave fullscreen playback before opening settings.',
      };
    settingsOpen = args[0];
    syncVisibility();
    publish();
    if (settingsOpen || error) mainWindow.webContents.focus();
    else contents.focus();
    return { ok: true, value: state() };
  });
  handle(IPC.updateUserAgents, async (...args) => {
    if (args.length !== 1)
      throw new Error('Expected one User-Agent operation.');
    const previous = store.activeUserAgent();
    const previousId = store.snapshot().activeId;
    await store.update(args[0]);
    publish();
    const current = store.activeUserAgent();
    if (current !== previous || store.snapshot().activeId !== previousId) {
      contents.setUserAgent(current);
      // Explicit UA for the current Leanback route; preserve cookies/session.
      try {
        await loadTV(isTVURL(contents.getURL()) ? contents.getURL() : TV_HOME);
      } catch {
        // The configuration is committed. loadTV publishes the load error;
        // return the saved state so the editor can finish this mutation.
      }
    }
  });
  handle(IPC.navigate, async (...args) => {
    if (args.length !== 1 || (args[0] !== 'home' && args[0] !== 'back')) {
      throw new Error('Unknown navigation action.');
    }
    if (args[0] === 'home') await loadTV(TV_HOME);
    else {
      if (!isTVURL(contents.getURL()) || error)
        throw new Error('Leanback is not available.');
      contents.send(IPC.requestTVBack);
    }
  });

  const dispatchBack = (event: IpcMainEvent, ...args: unknown[]) => {
    if (
      args.length ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame ||
      !isTVURL(event.senderFrame.url) ||
      error
    )
      return;
    // Leanback handles Escape through its own HISTORY_BACK command. Never call
    // navigationHistory.goBack() or synthesize Backspace here.
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  };
  ipcMain.on(IPC.dispatchTVBack, dispatchBack);

  contents.on('enter-html-full-screen', () => {
    playbackFullscreen = true;
    settingsOpen = false;
    syncVisibility();
    publish();
  });
  contents.on('leave-html-full-screen', () => {
    playbackFullscreen = false;
    syncVisibility();
    publish();
  });
  contents.on(
    'did-fail-load',
    (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3)
        reportError(`YouTube load failed (${code}): ${description}`);
    },
  );
  contents.on('render-process-gone', (_event, details) => {
    reportError(`YouTube renderer stopped: ${details.reason}`);
  });
  const guardTVNavigation = (event: Electron.Event, url: string) => {
    if (!isTVURL(url)) {
      event.preventDefault();
      reportError(
        'Navigation outside YouTube TV was blocked. The selected User-Agent may be unsupported.',
      );
    }
  };
  contents.on('will-navigate', (event, url) => guardTVNavigation(event, url));
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) guardTVNavigation(event, url);
  });
  contents.setWindowOpenHandler(() => {
    reportError(
      'YouTube requested a new window. Opening external windows is not supported.',
    );
    return { action: 'deny' };
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.webContents.on('will-navigate', (event, url) => {
    if (url !== toolbarURL) event.preventDefault();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== shellURL) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  mainWindow.on('closed', () => {
    overlays.dispose();
    dock.dispose();
    ratings.dispose();
    displayBridge.dispose();
    pageBridge.dispose();
    void extensions
      .dispose()
      .catch((cause) => console.error('Extension shutdown failed:', cause));
    for (const channel of [
      IPC.getState,
      IPC.toggleFullscreen,
      IPC.setHardwareAcceleration,
      IPC.restartApp,
      IPC.openProjectGitHub,
      IPC.openPrivacyPolicy,
      IPC.openSponsorBlock,
      IPC.openReturnYouTubeDislike,
      IPC.getExtensions,
      IPC.setExtensionEnabled,
      IPC.reloadTV,
      IPC.updateUserAgents,
      IPC.navigate,
      IPC.setSettingsOpen,
    ])
      ipcMain.removeHandler(channel);
    ipcMain.removeListener(IPC.dispatchTVBack, dispatchBack);
    // Closing the parent does not automatically close a child WebContentsView.
    if (!contents.isDestroyed()) contents.close();
    if (!toolbar.webContents.isDestroyed()) toolbar.webContents.close();
  });
  await Promise.all([
    mainWindow.loadURL(shellURL),
    ratings.load(),
    toolbar.webContents.loadURL(toolbarURL),
  ]);
  const startup = pending.then(() => loadTV(TV_HOME));
  pending = startup.catch(() => {}); // The local shell displays the error.
  await pending;
}
