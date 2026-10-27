import { app, BrowserWindow, dialog, Menu } from 'electron';
import { UserAgentStore } from './user-agent-store';
import { createTVWindow } from './tv-window';
import { GeneralSettingsStore } from './general-settings-store';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let general: GeneralSettingsStore;
  let configurationError: unknown;
  try {
    general = GeneralSettingsStore.open(app.getPath('userData'));
    if (!general.snapshot().hardwareAcceleration)
      app.disableHardwareAcceleration();
  } catch (cause) {
    configurationError = cause;
  }
  Menu.setApplicationMenu(null);
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    let store: UserAgentStore;
    try {
      if (configurationError) throw configurationError;
      store = await UserAgentStore.open(app.getPath('userData'));
    } catch (cause) {
      dialog.showErrorBox(
        'Tubevra configuration error',
        cause instanceof Error ? cause.message : String(cause),
      );
      app.quit();
      return;
    }
    const startWindow = async () => {
      try {
        await createTVWindow(store, general);
      } catch (cause) {
        dialog.showErrorBox(
          'Tubevra could not start',
          cause instanceof Error ? cause.message : String(cause),
        );
        app.quit();
      }
    };
    await startWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void startWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
