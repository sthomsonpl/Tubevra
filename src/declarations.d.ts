/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  codecSettings: import('./shared/extension-settings').CodecSettingsAPI;
  extensionSettings: import('./shared/extension-settings').ExtensionSettingsAPI;
  extensionSettingsHost: import('./shared/extension-settings').ExtensionSettingsHostAPI;
  ratings: import('./shared/ratings').RatingsAPI;
  tubevra: import('./shared/api').TubevraAPI;
}
