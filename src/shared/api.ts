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
  userAgents: UserAgentState;
  playbackFullscreen: boolean;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TubevraAPI {
  getState(): Promise<Result<AppState>>;
  updateUserAgents(command: UserAgentCommand): Promise<Result<AppState>>;
  navigate(action: 'back' | 'home'): Promise<Result<AppState>>;
  setSettingsOpen(open: boolean): Promise<Result<AppState>>;
  onStateChanged(listener: (state: AppState) => void): () => void;
}

export const IPC = Object.freeze({
  getState: 'tubevra:get-state',
  updateUserAgents: 'tubevra:update-user-agents',
  navigate: 'tubevra:navigate',
  setSettingsOpen: 'tubevra:set-settings-open',
  stateChanged: 'tubevra:state-changed',
  requestTVBack: 'tubevra:request-tv-back',
  dispatchTVBack: 'tubevra:dispatch-tv-back',
});
