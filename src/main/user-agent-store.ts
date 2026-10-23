import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CustomUserAgent,
  UserAgentCommand,
  UserAgentState,
} from '../shared/api';
import {
  DEFAULT_USER_AGENT_ID,
  USER_AGENT_PRESETS,
  USER_AGENT_NAMES,
} from '../config/user-agents';

interface Settings {
  version: 1;
  activeId: string;
  custom: CustomUserAgent[];
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.');
  }
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Unexpected configuration fields.');
  }
}

function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(value)) {
    throw new Error('Invalid preset identifier.');
  }
}

function preset(value: Record<string, unknown>) {
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 100 ||
    // Names must not contain control characters from an IPC/file payload.
    // oxlint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(value.name)
  ) {
    throw new Error('Preset name must contain 1–100 printable characters.');
  }
  if (
    typeof value.userAgent !== 'string' ||
    !value.userAgent.trim() ||
    value.userAgent.length > 4096 ||
    /[^\x20-\x7e]/.test(value.userAgent)
  ) {
    throw new Error(
      'User-Agent must contain 1–4096 printable ASCII characters.',
    );
  }
  return { name: value.name, userAgent: value.userAgent };
}

export function parseCommand(value: unknown): UserAgentCommand {
  record(value);
  switch (value.type) {
    case 'select':
      keys(value, ['type', 'id']);
      id(value.id);
      return { type: 'select', id: value.id };
    case 'add':
      keys(value, ['type', 'name', 'userAgent']);
      return { type: 'add', ...preset(value) };
    case 'edit':
      keys(value, ['type', 'id', 'name', 'userAgent']);
      id(value.id);
      return { type: 'edit', id: value.id, ...preset(value) };
    case 'remove':
      keys(value, ['type', 'id', 'replacementId']);
      id(value.id);
      if (value.replacementId !== undefined) id(value.replacementId);
      return {
        type: 'remove',
        id: value.id,
        replacementId: value.replacementId as string | undefined,
      };
    default:
      throw new Error('Unknown User-Agent operation.');
  }
}

function exists(settings: Settings, targetId: string) {
  return (
    Object.hasOwn(USER_AGENT_PRESETS, targetId) ||
    settings.custom.some((entry) => entry.id === targetId)
  );
}

function parseSettings(value: unknown): Settings {
  record(value);
  keys(value, ['version', 'activeId', 'custom']);
  if (
    value.version !== 1 ||
    !Array.isArray(value.custom) ||
    value.custom.length > 100
  ) {
    throw new Error('Unsupported or invalid User-Agent configuration.');
  }
  id(value.activeId);
  const seen = new Set<string>();
  const custom = value.custom.map((entry: unknown) => {
    record(entry);
    keys(entry, ['id', 'name', 'userAgent']);
    id(entry.id);
    if (!/^custom:[0-9a-f-]{36}$/.test(entry.id) || seen.has(entry.id)) {
      throw new Error('Invalid or duplicate custom preset identifier.');
    }
    seen.add(entry.id);
    return { id: entry.id, ...preset(entry) };
  });
  const settings: Settings = { version: 1, activeId: value.activeId, custom };
  if (!exists(settings, settings.activeId)) {
    throw new Error('The active User-Agent preset does not exist.');
  }
  return settings;
}

export class UserAgentStore {
  private file: string;
  private settings: Settings;
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(file: string, settings: Settings) {
    this.file = file;
    this.settings = settings;
  }

  static async open(userData: string) {
    const file = path.join(userData, 'user-agents.json');
    let settings: Settings;
    try {
      const content = await readFile(file, 'utf8');
      if (Buffer.byteLength(content) > 1024 * 1024) {
        throw new Error('User-Agent configuration exceeds 1 MiB.');
      }
      settings = parseSettings(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}. The file was preserved.`,
          {
            cause: error,
          },
        );
      }
      settings = { version: 1, activeId: DEFAULT_USER_AGENT_ID, custom: [] };
      const store = new UserAgentStore(file, settings);
      await store.save(settings);
      return store;
    }
    return new UserAgentStore(file, settings);
  }

  snapshot(): UserAgentState {
    return {
      activeId: this.settings.activeId,
      presets: [
        ...Object.entries(USER_AGENT_PRESETS).map(([id, userAgent]) => ({
          id,
          name: USER_AGENT_NAMES[id as keyof typeof USER_AGENT_NAMES],
          userAgent,
          builtIn: true,
        })),
        ...this.settings.custom.map((entry) => ({ ...entry, builtIn: false })),
      ],
    };
  }

  activeUserAgent(): string {
    return this.snapshot().presets.find(
      (entry) => entry.id === this.settings.activeId,
    )!.userAgent;
  }

  update(input: unknown): Promise<UserAgentState> {
    const operation = this.pending.then(async () => {
      const command = parseCommand(input);
      const next = structuredClone(this.settings);
      switch (command.type) {
        case 'select':
          if (!exists(next, command.id))
            throw new Error('Preset does not exist.');
          next.activeId = command.id;
          break;
        case 'add':
          if (next.custom.length >= 100)
            throw new Error('Custom preset limit reached (100).');
          next.custom.push({
            id: `custom:${randomUUID()}`,
            name: command.name,
            userAgent: command.userAgent,
          });
          break;
        case 'edit': {
          const entry = next.custom.find((entry) => entry.id === command.id);
          if (!entry)
            throw new Error('Only existing custom presets can be edited.');
          entry.name = command.name;
          entry.userAgent = command.userAgent;
          break;
        }
        case 'remove':
          if (!next.custom.some((entry) => entry.id === command.id)) {
            throw new Error('Only existing custom presets can be removed.');
          }
          if (next.activeId === command.id) {
            if (
              !command.replacementId ||
              command.replacementId === command.id ||
              !exists(next, command.replacementId)
            ) {
              throw new Error(
                'Choose an existing replacement for the active preset.',
              );
            }
            next.activeId = command.replacementId;
          }
          next.custom = next.custom.filter((entry) => entry.id !== command.id);
          break;
      }
      await this.save(next);
      this.settings = next;
      return this.snapshot();
    });
    // A failed write must not poison subsequent operations.
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
          console.error('Cannot remove temporary settings file:', error);
      });
    }
  }
}
