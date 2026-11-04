import type { Result } from './api';

export const EXTENSION_SETTINGS_IPC = Object.freeze({
  open: 'tubevra:extension-settings:open',
  close: 'tubevra:extension-settings:close',
  closed: 'tubevra:extension-settings:closed',
  get: 'tubevra:extension-settings:get',
  save: 'tubevra:extension-settings:save',
  resize: 'tubevra:extension-settings:resize',
});

export interface ExtensionSettingsHostAPI {
  open(): Promise<Result<null>>;
  close(): Promise<Result<null>>;
  onClosed(listener: (error?: string) => void): () => void;
}

export interface ExtensionSettingsAPI {
  get(): Promise<Result<boolean>>;
  save(showWithDock: boolean): Promise<Result<null>>;
  close(): Promise<Result<null>>;
  resize(height: number): Promise<Result<null>>;
}
