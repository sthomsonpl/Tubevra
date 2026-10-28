import { contextBridge, ipcRenderer } from 'electron';
import {
  RATINGS_IPC,
  type RatingsAPI,
  type RatingsSnapshot,
} from '../shared/ratings';

const api: RatingsAPI = {
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
