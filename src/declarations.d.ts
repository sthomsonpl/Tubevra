/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  ratings: import('./shared/ratings').RatingsAPI;
  tubevra: import('./shared/api').TubevraAPI;
}
