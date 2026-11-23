import { app, BrowserWindow, dialog, Menu } from 'electron';
import { UserAgentStore } from './user-agent-store';
import { createTVWindow } from './tv-window';
import { GeneralSettingsStore } from './general-settings-store';
import { detectSystemLanguage } from './system-language';
import { createI18n } from '../shared/i18n/i18n';
import type { Language } from '../shared/i18n/language';
import en from '../shared/i18n/en.json';

async function showStartupError(
  titleKey: 'configurationError' | 'couldNotStart',
  language: Language,
  cause: unknown,
): Promise<void> {
  let title: string = en.startup[titleKey];
  try {
    title = (await createI18n(language)).t(`startup.${titleKey}`);
  } catch (i18nError) {
    console.error('Failed to localize startup error dialog', i18nError);
  }
  dialog.showErrorBox(
    title,
    cause instanceof Error ? cause.message : String(cause),
  );
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.sthomsonpl.tubevra');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let general: GeneralSettingsStore;
  let configurationError: unknown;
  const systemLanguage = detectSystemLanguage();
  try {
    general = GeneralSettingsStore.open(
      app.getPath('userData'),
      systemLanguage,
    );
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
      await showStartupError(
        'configurationError',
        general?.snapshot().language ?? systemLanguage,
        cause,
      );
      return;
    }
    const startWindow = async () => {
      try {
        await createTVWindow(store, general);
      } catch (cause) {
        await showStartupError(
          'couldNotStart',
          general.snapshot().language,
          cause,
        );
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
