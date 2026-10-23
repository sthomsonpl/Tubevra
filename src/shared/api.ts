import type { ExtensionsState } from '../extensions/types';
import type { ExtensionCommand } from '../extensions/types';

export interface CustomUserAgent {
  id: string;
  name: string;
  userAgent: string;
}

export interface UserAgentState {
  activeId: string;
  presets: (CustomUserAgent & { builtIn: boolean })[];
}

export type UserAgentCommand =
  | { type: 'select'; id: string }
  | { type: 'add'; name: string; userAgent: string }
  | { type: 'edit'; id: string; name: string; userAgent: string }
  | { type: 'remove'; id: string; replacementId?: string };

export interface AppState {
  mode: 'tv';
  extensions: ExtensionsState;
  userAgents: UserAgentState;
  playbackFullscreen: boolean;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Narrow operations exposed only to the trusted local application UI.
export interface ExtensionsAPI {
  getExtensions(): Promise<Result<ExtensionsState>>;
  setExtensionEnabled(
    command: ExtensionCommand,
  ): Promise<Result<ExtensionsState>>;
  onExtensionsStateChanged(
    listener: (state: ExtensionsState) => void,
  ): () => void;
}

export interface TubevraAPI extends ExtensionsAPI {
  reloadTV(): Promise<Result<AppState>>;
  getState(): Promise<Result<AppState>>;
  updateUserAgents(command: UserAgentCommand): Promise<Result<AppState>>;
  navigate(action: 'back' | 'home'): Promise<Result<AppState>>;
  setSettingsOpen(open: boolean): Promise<Result<AppState>>;
  onStateChanged(listener: (state: AppState) => void): () => void;
}

export const IPC = Object.freeze({
  getState: 'tubevra:get-state',
  reloadTV: 'tubevra:reload-tv',
  updateUserAgents: 'tubevra:update-user-agents',
  navigate: 'tubevra:navigate',
  setSettingsOpen: 'tubevra:set-settings-open',
  stateChanged: 'tubevra:state-changed',
  requestTVBack: 'tubevra:request-tv-back',
  dispatchTVBack: 'tubevra:dispatch-tv-back',
  getExtensions: 'tubevra:extensions:get',
  setExtensionEnabled: 'tubevra:extensions:set-enabled',
  extensionsStateChanged: 'tubevra:extensions:state-changed',
});
