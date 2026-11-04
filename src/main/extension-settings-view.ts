import { ipcMain, WebContentsView } from 'electron';
import type { BrowserWindow, WebContents, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { EXTENSION_SETTINGS_IPC as IPC } from '../shared/extension-settings';
import type { Result } from '../shared/api';

export function createExtensionSettingsView(
  window: BrowserWindow,
  host: WebContents,
  hostURL: string,
  options: {
    canOpen(): boolean;
    getPreference(): boolean;
    savePreference(value: boolean): Promise<unknown>;
    onVisibility(open: boolean): void;
  },
) {
  const url = `${hostURL}#extension-settings`;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'extension-settings-preload.cjs'),
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  // Same native material as settings, bounded to the options card.
  view.setBackgroundColor('#2412161d');
  view.setBackgroundBlur(18);
  view.setBorderRadius(16);
  view.setVisible(false);
  window.contentView.addChildView(view);
  let active = false;
  let saving = false;
  let disposed = false;
  let version = 0;
  let desiredHeight = 244;
  const layout = () => {
    if (disposed || window.isDestroyed()) return;
    const bounds = window.contentView.getBounds();
    const width = Math.max(1, Math.min(520, bounds.width - 32));
    const height = Math.max(1, Math.min(desiredHeight, bounds.height - 48));
    view.setBounds({
      x: Math.round((bounds.width - width) / 2),
      y: Math.round((bounds.height - height) / 2),
      width,
      height,
    });
  };
  const matches = (
    event: IpcMainInvokeEvent,
    contents: WebContents,
    target: string,
  ) =>
    !disposed &&
    !window.isDestroyed() &&
    !contents.isDestroyed() &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    event.senderFrame.url === target;
  const fromHost = (event: IpcMainInvokeEvent) => matches(event, host, hostURL);
  const assertOptions = (event: IpcMainInvokeEvent) => {
    if (!active || !matches(event, view.webContents, url))
      throw Error('Untrusted extension settings request.');
  };
  const close = (force = false, error?: string) => {
    if (saving && !force) throw Error('Wait for settings to finish saving.');
    if (!active) return;
    active = false;
    version++;
    view.setVisible(false);
    options.onVisibility(false);
    if (!host.isDestroyed()) {
      host.send(IPC.closed, error);
      if (options.canOpen() && window.isFocused()) host.focus();
    }
  };
  const result = async <T>(
    action: () => T | Promise<T>,
  ): Promise<Result<T>> => {
    try {
      return { ok: true, value: await action() };
    } catch (cause) {
      return {
        ok: false,
        error:
          cause instanceof Error ? cause.message : 'Extension settings failed.',
      };
    }
  };
  ipcMain.handle(IPC.open, (event, ...args) => {
    if (!fromHost(event)) throw Error('Untrusted extension settings host.');
    return result(async () => {
      if (args.length) throw Error('Unexpected arguments.');
      if (!options.canOpen()) throw Error('Open application settings first.');
      if (active || saving) throw Error('Extension settings are already busy.');
      active = true;
      const opening = ++version;
      desiredHeight = 244;
      layout();
      options.onVisibility(true);
      try {
        // A fresh local document starts every draft from the saved preference.
        if (view.webContents.getURL() === url) {
          await new Promise<void>((resolve, reject) => {
            const contents = view.webContents;
            const clear = () => {
              contents.removeListener('did-finish-load', finished);
              contents.removeListener('did-fail-load', failed);
              contents.removeListener('destroyed', destroyed);
            };
            const finished = () => {
              clear();
              resolve();
            };
            const failed = (
              _event: Electron.Event,
              _code: number,
              message: string,
              _url: string,
              mainFrame: boolean,
            ) => {
              if (mainFrame) {
                clear();
                reject(Error(message));
              }
            };
            const destroyed = () => {
              clear();
              reject(Error('Extension settings were closed.'));
            };
            contents.once('did-finish-load', finished);
            contents.on('did-fail-load', failed);
            contents.once('destroyed', destroyed);
            contents.reload();
          });
        } else await view.webContents.loadURL(url);
        if (disposed || !active || version !== opening)
          throw Error('Extension settings were closed.');
        view.setVisible(true);
        view.webContents.focus();
      } catch (cause) {
        if (!disposed && version === opening) close(true);
        throw cause;
      }
      return null;
    });
  });
  ipcMain.handle(IPC.get, (event, ...args) => {
    assertOptions(event);
    return result(() => {
      if (args.length) throw Error('Unexpected arguments.');
      return options.getPreference();
    });
  });
  ipcMain.handle(IPC.save, (event, ...args) => {
    assertOptions(event);
    return result(async () => {
      if (args.length !== 1 || typeof args[0] !== 'boolean')
        throw Error('Expected one RYD visibility flag.');
      if (saving) throw Error('Settings are already saving.');
      saving = true;
      try {
        await options.savePreference(args[0]);
      } finally {
        saving = false;
      }
      return null;
    });
  });
  ipcMain.handle(IPC.close, (event, ...args) => {
    if (!fromHost(event)) assertOptions(event);
    return result(() => {
      if (args.length) throw Error('Unexpected arguments.');
      close();
      return null;
    });
  });
  ipcMain.handle(IPC.resize, (event, ...args) => {
    assertOptions(event);
    return result(() => {
      const height = args[0];
      if (
        args.length !== 1 ||
        typeof height !== 'number' ||
        !Number.isInteger(height) ||
        height < 160 ||
        height > 2000
      )
        throw Error('Invalid options height.');
      desiredHeight = height;
      layout();
      return null;
    });
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, target) => {
    if (target !== url) event.preventDefault();
  });
  view.webContents.on('will-redirect', (event) => event.preventDefault());
  view.webContents.on('render-process-gone', () =>
    close(true, 'The extension settings renderer stopped. Please reopen it.'),
  );
  view.webContents.on('preload-error', () =>
    close(true, 'Could not load extension settings controls.'),
  );
  const hostNavigation = (
    _event: Electron.Event,
    _url: string,
    inPlace: boolean,
    mainFrame: boolean,
  ) => {
    if (mainFrame && !inPlace) close(true);
  };
  const hostStopped = () =>
    close(true, 'Application settings stopped. Please reopen them.');
  host.on('did-start-navigation', hostNavigation);
  host.on('render-process-gone', hostStopped);
  return {
    view,
    layout,
    close,
    isOpen: () => active,
    dispose() {
      disposed = true;
      version++;
      active = false;
      host.removeListener('did-start-navigation', hostNavigation);
      host.removeListener('render-process-gone', hostStopped);
      for (const channel of [
        IPC.open,
        IPC.get,
        IPC.save,
        IPC.close,
        IPC.resize,
      ])
        ipcMain.removeHandler(channel);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
