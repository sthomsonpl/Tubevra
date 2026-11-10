import type { PlaybackResolution } from './tv-display';
import type { CodecPreferences } from './media-capabilities';
import type { ExtensionsState } from '../extensions/types';
import type { ExtensionCommand } from '../extensions/types';
import type { Language, LanguagePreference } from './i18n/language';

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

export interface GeneralSettingsState {
  language: Language;
  languagePreference: LanguagePreference;
  codecPreferences: CodecPreferences;
  playbackResolution: PlaybackResolution;
  hardwareAcceleration: boolean;
  restartRequired: boolean;
}

export const SETTINGS_SECTIONS = [
  'general',
  'tv',
  'user-agents',
  'extensions',
  'about',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface AppState {
  version: string;
  general: GeneralSettingsState;
  mode: 'tv';
  extensions: ExtensionsState;
  userAgents: UserAgentState;
  playbackFullscreen: boolean;
  windowFullscreen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  loading: boolean;
  error: string | null;
  codecWarning: string | null;
  codecReloadRequired: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Narrow operations exposed only to the trusted local application UI.
export interface ExtensionsAPI {
  setRydShowWithDock(enabled: boolean): Promise<Result<ExtensionsState>>;
  getExtensions(): Promise<Result<ExtensionsState>>;
  setExtensionEnabled(
    command: ExtensionCommand,
  ): Promise<Result<ExtensionsState>>;
  onExtensionsStateChanged(
    listener: (state: ExtensionsState) => void,
  ): () => void;
}

export interface TubevraAPI extends ExtensionsAPI {
  setLanguage(language: LanguagePreference): Promise<Result<AppState>>;
  setCodecPreferences(value: CodecPreferences): Promise<Result<AppState>>;
  toggleFullscreen(): Promise<Result<AppState>>;
  setPlaybackResolution(value: PlaybackResolution): Promise<Result<AppState>>;
  setHardwareAcceleration(enabled: boolean): Promise<Result<AppState>>;
  restartApp(): Promise<Result<AppState>>;
  openProjectGitHub(): Promise<Result<null>>;
  openPrivacyPolicy(): Promise<Result<null>>;
  openSponsorBlock(): Promise<Result<null>>;
  openReturnYouTubeDislike(): Promise<Result<null>>;
  reloadTV(): Promise<Result<AppState>>;
  getState(): Promise<Result<AppState>>;
  updateUserAgents(command: UserAgentCommand): Promise<Result<AppState>>;
  navigate(action: 'back' | 'home'): Promise<Result<AppState>>;
  setSettingsOpen(open: boolean): Promise<Result<AppState>>;
  setSettingsSection(section: SettingsSection): Promise<Result<null>>;
  onStateChanged(listener: (state: AppState) => void): () => void;
}

export const IPC = Object.freeze({
  setLanguage: 'tubevra:set-language',
  setCodecPreferences: 'tubevra:set-codec-preferences',
  toggleFullscreen: 'tubevra:toggle-fullscreen',
  setHardwareAcceleration: 'tubevra:set-hardware-acceleration',
  setPlaybackResolution: 'tubevra:set-playback-resolution',
  restartApp: 'tubevra:restart-app',
  openProjectGitHub: 'tubevra:open-project-github',
  openPrivacyPolicy: 'tubevra:open-privacy-policy',
  openSponsorBlock: 'tubevra:open-sponsorblock',
  openReturnYouTubeDislike: 'tubevra:open-return-youtube-dislike',
  getState: 'tubevra:get-state',
  reloadTV: 'tubevra:reload-tv',
  updateUserAgents: 'tubevra:update-user-agents',
  navigate: 'tubevra:navigate',
  setSettingsOpen: 'tubevra:set-settings-open',
  setSettingsSection: 'tubevra:set-settings-section',
  stateChanged: 'tubevra:state-changed',
  requestTVBack: 'tubevra:request-tv-back',
  dispatchTVBack: 'tubevra:dispatch-tv-back',
  setRydShowWithDock: 'tubevra:ryd:set-show-with-dock',
  getExtensions: 'tubevra:extensions:get',
  setExtensionEnabled: 'tubevra:extensions:set-enabled',
  extensionsStateChanged: 'tubevra:extensions:state-changed',
});

export const PROJECT_GITHUB_URL = 'https://github.com/sthomsonpl/Tubevra';
export const PRIVACY_POLICY_URL = `${PROJECT_GITHUB_URL}/blob/main/PRIVACY.md`;
export const SPONSORBLOCK_URL = 'https://sponsor.ajay.app/';
export const RYD_URL = 'https://github.com/Anarios/return-youtube-dislike';
