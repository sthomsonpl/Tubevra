import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneralSettingsState } from '../shared/api';

interface Settings {
  version: 1;
  hardwareAcceleration: boolean;
}

export class GeneralSettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly startupHardwareAcceleration: boolean;

  private constructor(
    private readonly file: string,
    private settings: Settings,
  ) {
    this.startupHardwareAcceleration = settings.hardwareAcceleration;
  }

  // Electron needs this preference synchronously, before the ready event.
  static open(userData: string) {
    const file = path.join(userData, 'general-settings.json');
    let settings: Settings = { version: 1, hardwareAcceleration: true };
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
        Object.keys(value).some(
          (key) => key !== 'version' && key !== 'hardwareAcceleration',
        )
      )
        throw new Error('Unsupported or invalid general configuration.');
      settings = {
        version: 1,
        hardwareAcceleration: value.hardwareAcceleration,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}. The file was preserved.`,
          { cause: error },
        );
    }
    return new GeneralSettingsStore(file, settings);
  }

  snapshot(): GeneralSettingsState {
    return {
      hardwareAcceleration: this.settings.hardwareAcceleration,
      restartRequired:
        this.settings.hardwareAcceleration !== this.startupHardwareAcceleration,
    };
  }

  setHardwareAcceleration(enabled: unknown): Promise<GeneralSettingsState> {
    const operation = this.pending.then(async () => {
      if (typeof enabled !== 'boolean')
        throw new Error('Expected a hardware acceleration flag.');
      const next: Settings = { version: 1, hardwareAcceleration: enabled };
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
