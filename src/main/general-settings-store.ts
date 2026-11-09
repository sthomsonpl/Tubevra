import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneralSettingsState } from '../shared/api';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LANGUAGE_PREFERENCE,
  isLanguagePreference,
  type Language,
  type LanguagePreference,
} from '../shared/i18n/language';
import {
  DEFAULT_CODEC_PREFERENCES,
  freezeCodecPreferences,
  isCodecPreferences,
  type CodecPreferences,
} from '../shared/media-capabilities';

import {
  isPlaybackResolution,
  type PlaybackResolution,
} from '../shared/tv-display';
interface Settings {
  language: LanguagePreference;
  codecPreferences: CodecPreferences;
  playbackResolution: PlaybackResolution;
  version: 1;
  hardwareAcceleration: boolean;
}

export class GeneralSettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly startupHardwareAcceleration: boolean;

  private constructor(
    private readonly file: string,
    private settings: Settings,
    private readonly systemLanguage: Language,
  ) {
    this.startupHardwareAcceleration = settings.hardwareAcceleration;
  }

  // Electron needs this preference synchronously, before the ready event.
  static open(userData: string, systemLanguage: Language = DEFAULT_LANGUAGE) {
    const file = path.join(userData, 'general-settings.json');
    let settings: Settings = {
      language: DEFAULT_LANGUAGE_PREFERENCE,
      codecPreferences: DEFAULT_CODEC_PREFERENCES,
      version: 1,
      hardwareAcceleration: true,
      playbackResolution: 'auto',
    };
    try {
      const content = readFileSync(file, 'utf8');
      if (Buffer.byteLength(content) > 4096)
        throw new Error('General configuration exceeds 4 KiB.');
      const value: unknown = JSON.parse(content);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('version' in value) ||
        value.version !== 1 ||
        !('hardwareAcceleration' in value) ||
        typeof value.hardwareAcceleration !== 'boolean' ||
        ('language' in value && !isLanguagePreference(value.language)) ||
        ('playbackResolution' in value &&
          !isPlaybackResolution(value.playbackResolution)) ||
        ('codecPreferences' in value &&
          !isCodecPreferences(value.codecPreferences)) ||
        Object.keys(value).some(
          (key) =>
            key !== 'version' &&
            key !== 'hardwareAcceleration' &&
            key !== 'codecPreferences' &&
            key !== 'language' &&
            key !== 'playbackResolution',
        )
      )
        throw new Error('Unsupported or invalid general configuration.');
      settings = {
        language:
          'language' in value
            ? (value.language as LanguagePreference)
            : DEFAULT_LANGUAGE_PREFERENCE,
        codecPreferences:
          'codecPreferences' in value
            ? freezeCodecPreferences(value.codecPreferences)
            : DEFAULT_CODEC_PREFERENCES,
        version: 1,
        playbackResolution:
          'playbackResolution' in value
            ? (value.playbackResolution as PlaybackResolution)
            : 'auto',
        hardwareAcceleration: value.hardwareAcceleration,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}. The file was preserved.`,
          { cause: error },
        );
    }
    return new GeneralSettingsStore(file, settings, systemLanguage);
  }

  snapshot(): GeneralSettingsState {
    return {
      language:
        this.settings.language === 'auto'
          ? this.systemLanguage
          : this.settings.language,
      languagePreference: this.settings.language,
      codecPreferences: this.settings.codecPreferences,
      playbackResolution: this.settings.playbackResolution,
      hardwareAcceleration: this.settings.hardwareAcceleration,
      restartRequired:
        this.settings.hardwareAcceleration !== this.startupHardwareAcceleration,
    };
  }

  setLanguage(language: unknown): Promise<GeneralSettingsState> {
    return this.update(() => {
      if (!isLanguagePreference(language)) throw new Error('Invalid language.');
      return { ...this.settings, language };
    });
  }

  setHardwareAcceleration(enabled: unknown): Promise<GeneralSettingsState> {
    return this.update(() => {
      if (typeof enabled !== 'boolean')
        throw new Error('Expected a hardware acceleration flag.');
      return { ...this.settings, hardwareAcceleration: enabled };
    });
  }
  setCodecPreferences(value: unknown): Promise<GeneralSettingsState> {
    // Own the validated request before it waits for other configuration writes.
    let preferences: CodecPreferences;
    try {
      preferences = freezeCodecPreferences(value);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.update(() => ({
      ...this.settings,
      codecPreferences: preferences,
    }));
  }
  setPlaybackResolution(value: unknown): Promise<GeneralSettingsState> {
    return this.update(() => {
      if (!isPlaybackResolution(value))
        throw new Error('Invalid playback resolution.');
      return { ...this.settings, playbackResolution: value };
    });
  }
  private update(change: () => Settings): Promise<GeneralSettingsState> {
    const operation = this.pending.then(async () => {
      const next = change();
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporary, this.file);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT')
            console.error(
              'Cannot remove temporary general settings file:',
              error,
            );
        });
      }
      this.settings = next;
      return this.snapshot();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
