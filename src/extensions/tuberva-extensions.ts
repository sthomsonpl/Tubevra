import type {
  Cleanup,
  ExtensionMetadata,
  ExtensionsState,
  ExtensionState,
  MainExtensionStart,
} from './types';
import { ExtensionStore, parseExtensionCommand } from './main/extension-store';
import { RequestDispatcher } from './main/request-dispatcher';
import type { RequestSource } from './main/request-dispatcher';

export class TubervaExtensions {
  private pending: Promise<unknown> = Promise.resolve();
  private items: ExtensionState[];
  private resources = new Map<string, Cleanup[]>();
  private revision = 0;
  private closed = false;
  private dispatcher: RequestDispatcher;
  private constructor(
    private store: ExtensionStore,
    registry: readonly ExtensionMetadata[],
    source: RequestSource,
    private starts: Readonly<Record<string, MainExtensionStart>>,
    private publish: () => void,
  ) {
    this.items = registry.map((item) => ({
      ...item,
      enabled: store.enabled(item.id),
      status: 'disabled',
      error: null,
    }));
    this.dispatcher = new RequestDispatcher(source, (id, cause) => {
      const item = this.items.find((item) => item.id === id)!;
      item.status = 'error';
      this.revision++;
      item.error = String(cause);
      this.publish();
      void this.enqueue(async () => {
        await this.stop(item);
        item.error = [String(cause), item.error].filter(Boolean).join('\n');
        item.status = 'error';
        this.publish();
      });
    });
  }
  static async open(
    directory: string,
    registry: readonly ExtensionMetadata[],
    source: RequestSource,
    starts: Readonly<Record<string, MainExtensionStart>>,
    publish: () => void = () => {},
  ) {
    const ids = new Set<string>();
    for (const item of registry) {
      if (
        !/^[a-zA-Z0-9:_-]{1,100}$/.test(item.id) ||
        ids.has(item.id) ||
        (!item.main && !item.page)
      )
        throw new Error('Invalid extension registry.');
      ids.add(item.id);
    }
    const engine = new TubervaExtensions(
      await ExtensionStore.open(directory, registry),
      registry,
      source,
      starts,
      publish,
    );
    await engine.enqueue(async () => {
      for (const item of engine.items) await engine.apply(item);
    });
    return engine;
  }
  snapshot(): ExtensionsState {
    return structuredClone({
      revision: this.revision,
      error: null,
      items: this.items,
    });
  }
  update(input: unknown) {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('Extension engine is closed.');
      const command = parseExtensionCommand(input);
      const item = this.items.find((item) => item.id === command.id);
      if (!item || !item.modes.includes('tv'))
        throw new Error('Extension is unavailable in TV mode.');
      await this.store.update(command);
      this.revision++;
      item.enabled = command.enabled;
      await this.stop(item);
      if (!item.error) await this.apply(item);
      this.publish();
      return this.snapshot();
    });
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(action);
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async stop(item: ExtensionState) {
    this.dispatcher.remove(item.id);
    const resources = this.resources.get(item.id) ?? [];
    this.resources.delete(item.id);
    const errors: string[] = [];
    for (const cleanup of resources.reverse()) {
      try {
        await cleanup();
      } catch (cause) {
        errors.push(String(cause));
      }
    }
    item.status = errors.length ? 'error' : 'disabled';
    item.error = errors.length ? errors.join('\n') : null;
  }
  private async apply(item: ExtensionState) {
    if (!item.enabled || !item.modes.includes('tv') || this.closed) return;
    item.status = 'starting';
    this.publish();
    const resources: Cleanup[] = [];
    this.resources.set(item.id, resources);
    let accepting = true;
    try {
      if (item.main) {
        const start = this.starts[item.id];
        if (typeof start !== 'function')
          throw new Error('Missing main extension implementation.');
        const cleanup = await start({
          registerRule: (rule) => {
            if (!accepting || item.status === 'error' || this.closed)
              throw new Error('Extension start context is closed.');
            this.dispatcher.register(item.id, rule);
          },
          onCleanup: (cleanup) => {
            if (!accepting)
              throw new Error('Extension start context is closed.');
            resources.push(cleanup);
          },
        });
        if (typeof cleanup !== 'function')
          throw new Error('Extension must return cleanup.');
        resources.push(cleanup);
      }
      if (!item.error) item.status = item.page ? 'starting' : 'active';
    } catch (cause) {
      await this.stop(item);
      item.error = [String(cause), item.error].filter(Boolean).join('\n');
      item.status = 'error';
      this.revision++;
    } finally {
      accepting = false;
    }
    this.publish();
  }
  resetPage() {
    this.revision++;
    for (const item of this.items)
      if (item.page && item.enabled && item.status !== 'error')
        item.status = 'starting';
    this.publish();
  }
  reportPage(input: unknown) {
    return this.enqueue(async () => {
      if (this.closed || !input || typeof input !== 'object') return;
      const value = input as import('./types').PageReport;
      if (
        value.revision !== this.revision ||
        typeof value.id !== 'string' ||
        !['active', 'disabled', 'error', 'reload-required'].includes(
          value.status,
        ) ||
        (value.error !== null &&
          (typeof value.error !== 'string' || value.error.length > 10000))
      )
        return;
      const item = this.items.find((item) => item.id === value.id && item.page);
      if (!item || (value.status === 'active' && (!item.enabled || item.error)))
        return;
      if (item.error && item.enabled && value.status !== 'error') return;
      if (value.status === 'disabled' && item.enabled) return;
      if (value.status === 'error') await this.stop(item);
      item.status = value.status;
      item.error = [item.error, value.error].filter(Boolean).join('\n') || null;
      this.publish();
    });
  }
  dispose() {
    this.closed = true;
    return this.enqueue(async () => {
      for (const item of this.items) await this.stop(item);
      this.dispatcher.dispose();
      this.publish();
    });
  }
}
