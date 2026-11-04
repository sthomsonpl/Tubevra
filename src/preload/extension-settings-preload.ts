import { contextBridge, ipcRenderer } from 'electron';
import {
  EXTENSION_SETTINGS_IPC as IPC,
  type ExtensionSettingsAPI,
} from '../shared/extension-settings';

const api: ExtensionSettingsAPI = {
  get: () => ipcRenderer.invoke(IPC.get),
  save: (value) => ipcRenderer.invoke(IPC.save, value),
  close: () => ipcRenderer.invoke(IPC.close),
  resize: (height) => ipcRenderer.invoke(IPC.resize, height),
};
contextBridge.exposeInMainWorld('extensionSettings', api);
