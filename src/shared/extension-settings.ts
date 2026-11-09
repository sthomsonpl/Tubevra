import type { Result } from './api';
import type { CodecPreferences } from './media-capabilities';
import type { Language } from './i18n/language';

export const EXTENSION_SETTINGS_IPC = Object.freeze({
  open: 'tubevra:extension-settings:open',
  close: 'tubevra:extension-settings:close',
  closed: 'tubevra:extension-settings:closed',
  get: 'tubevra:extension-settings:get',
  getLanguage: 'tubevra:options:get-language',
  save: 'tubevra:extension-settings:save',
  resize: 'tubevra:extension-settings:resize',
  getCodecs: 'tubevra:options:codecs:get',
  saveCodecs: 'tubevra:options:codecs:save',
  reloadCodecs: 'tubevra:options:codecs:reload',
});

export interface ExtensionSettingsHostAPI {
  open(kind?: 'codecs'): Promise<Result<null>>;
  close(): Promise<Result<null>>;
  onClosed(listener: (error?: string) => void): () => void;
}

export interface CodecSettingsState {
  preferences: CodecPreferences;
  reloadRequired: boolean;
  error: string | null;
}

export interface CodecSettingsAPI {
  getLanguage(): Promise<Language>;
  get(): Promise<Result<CodecSettingsState>>;
  save(value: CodecPreferences): Promise<Result<CodecSettingsState>>;
  reload(): Promise<Result<CodecSettingsState>>;
  close(): Promise<Result<null>>;
  resize(height: number): Promise<Result<null>>;
}

export interface ExtensionSettingsAPI {
  getLanguage(): Promise<Language>;
  get(): Promise<Result<boolean>>;
  save(showWithDock: boolean): Promise<Result<null>>;
  close(): Promise<Result<null>>;
  resize(height: number): Promise<Result<null>>;
}
