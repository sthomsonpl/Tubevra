/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  tubevra: import('./shared/api').TubevraAPI;
}
