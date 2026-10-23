import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionCommand, ExtensionMetadata } from '../types';

interface Settings {
  version: 1;
  enabled: Record<string, boolean>;
}
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id);
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
}
export function parseExtensionCommand(value: unknown): ExtensionCommand {
  object(value);
  if (
    Object.keys(value).length !== 2 ||
    !validId(value.id) ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('Invalid extension command.');
  return { id: value.id, enabled: value.enabled };
}
export class ExtensionStore {
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(
    private file: string,
    private settings: Settings,
    private registry: readonly ExtensionMetadata[],
  ) {}
  static async open(directory: string, registry: readonly ExtensionMetadata[]) {
    const file = path.join(directory, 'extensions.json');
    let settings: Settings;
    try {
      const content = await readFile(file, 'utf8');
      if (Buffer.byteLength(content) > 1024 * 1024)
        throw new Error('Extension configuration exceeds 1 MiB.');
      const value: unknown = JSON.parse(content);
      object(value);
      if (
        value.version !== 1 ||
        Object.keys(value).some((key) => !['version', 'enabled'].includes(key))
      )
        throw new Error('Unsupported extension configuration.');
      object(value.enabled);
      if (
        Object.entries(value.enabled).some(
          ([id, enabled]) => !validId(id) || typeof enabled !== 'boolean',
        )
      )
        throw new Error('Invalid extension settings.');
      settings = {
        version: 1,
        enabled: value.enabled as Record<string, boolean>,
      };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Cannot read ${file}: ${String(cause)}. The file was preserved.`,
          { cause },
        );
      settings = {
        version: 1,
        enabled: Object.fromEntries(
          registry.map((item) => [item.id, item.defaultEnabled]),
        ),
      };
      const store = new ExtensionStore(file, settings, registry);
      await store.save(settings);
      return store;
    }
    return new ExtensionStore(file, settings, registry);
  }
  enabled(id: string) {
    return Object.hasOwn(this.settings.enabled, id)
      ? this.settings.enabled[id]
      : (this.registry.find((item) => item.id === id)?.defaultEnabled ?? false);
  }
  update(input: unknown): Promise<void> {
    const operation = this.pending.then(async () => {
      const command = parseExtensionCommand(input);
      if (!this.registry.some((item) => item.id === command.id))
        throw new Error('Unknown extension.');
      const next: Settings = {
        version: 1,
        enabled: { ...this.settings.enabled, [command.id]: command.enabled },
      };
      await this.save(next);
      this.settings = next;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async save(settings: Settings) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT')
          console.error('Cannot remove temporary extension settings:', error);
      });
    }
  }
}
