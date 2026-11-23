import { contextBridge, ipcRenderer } from 'electron';
import type { Language } from '../shared/i18n/language';
import {
  RATINGS_IPC,
  type RatingsAPI,
  type RatingsSnapshot,
} from '../shared/ratings';

const api: RatingsAPI = {
  getLanguage: () => ipcRenderer.invoke(RATINGS_IPC.getLanguage),
  onLanguageChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, language: Language) =>
      listener(language);
    ipcRenderer.on(RATINGS_IPC.languageChanged, handler);
    return () => {
      ipcRenderer.removeListener(RATINGS_IPC.languageChanged, handler);
    };
  },
  getSnapshot: () => ipcRenderer.invoke(RATINGS_IPC.get),
  subscribe(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: RatingsSnapshot,
    ) => listener(value);
    ipcRenderer.on(RATINGS_IPC.changed, handler);
    return () => ipcRenderer.removeListener(RATINGS_IPC.changed, handler);
  },
};
contextBridge.exposeInMainWorld('ratings', api);
