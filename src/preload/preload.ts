import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/api';
import type { AppState, TubevraAPI } from '../shared/api';
import type { ExtensionsState } from '../extensions/types';

const api: TubevraAPI = {
  openProjectGitHub: () => ipcRenderer.invoke(IPC.openProjectGitHub),
  reloadTV: () => ipcRenderer.invoke(IPC.reloadTV),
  getExtensions: () => ipcRenderer.invoke(IPC.getExtensions),
  setExtensionEnabled: (command) =>
    ipcRenderer.invoke(IPC.setExtensionEnabled, command),
  onExtensionsStateChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: ExtensionsState,
    ) => listener(state);
    ipcRenderer.on(IPC.extensionsStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC.extensionsStateChanged, handler);
  },
  getState: () => ipcRenderer.invoke(IPC.getState),
  updateUserAgents: (command) =>
    ipcRenderer.invoke(IPC.updateUserAgents, command),
  navigate: (action) => ipcRenderer.invoke(IPC.navigate, action),
  setSettingsOpen: (open) => ipcRenderer.invoke(IPC.setSettingsOpen, open),
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) =>
      listener(state);
    ipcRenderer.on(IPC.stateChanged, handler);
    return () => ipcRenderer.removeListener(IPC.stateChanged, handler);
  },
};

contextBridge.exposeInMainWorld('tubevra', api);
