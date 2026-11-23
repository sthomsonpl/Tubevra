import { contextBridge, ipcRenderer } from 'electron';
import {
  EXTENSION_SETTINGS_IPC as IPC,
  type ExtensionSettingsAPI,
  type CodecSettingsAPI,
  type QualityRemovalSettingsAPI,
} from '../shared/extension-settings';

const api: ExtensionSettingsAPI = {
  getLanguage: () => ipcRenderer.invoke(IPC.getLanguage),
  get: () => ipcRenderer.invoke(IPC.get),
  save: (value) => ipcRenderer.invoke(IPC.save, value),
  close: () => ipcRenderer.invoke(IPC.close),
  resize: (height) => ipcRenderer.invoke(IPC.resize, height),
};
contextBridge.exposeInMainWorld('extensionSettings', api);
const codecs: CodecSettingsAPI = {
  getLanguage: api.getLanguage,
  get: () => ipcRenderer.invoke(IPC.getCodecs),
  save: (value) => ipcRenderer.invoke(IPC.saveCodecs, value),
  reload: () => ipcRenderer.invoke(IPC.reloadCodecs),
  close: api.close,
  resize: api.resize,
};
contextBridge.exposeInMainWorld('codecSettings', codecs);
const quality: QualityRemovalSettingsAPI = {
  getLanguage: api.getLanguage,
  get: () => ipcRenderer.invoke(IPC.getQuality),
  save: (hidden) => ipcRenderer.invoke(IPC.saveQuality, hidden),
  close: api.close,
  resize: api.resize,
};
contextBridge.exposeInMainWorld('qualityRemovalSettings', quality);
