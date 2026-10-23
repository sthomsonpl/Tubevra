import { deadline, releaseLate } from './lifecycle';
import { validateHookManifest } from './hooks/validation';
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
  private runtimeError: string | null = null;
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
      reloadRequired: false,
      reloadReason: null,
      layers: {},
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
    hookManifest: readonly string[] = [],
  ) {
    const ids = new Set<string>();
    for (const item of registry) {
      if (
        !/^[a-zA-Z0-9:_-]{1,100}$/.test(item.id) ||
        ids.has(item.id) ||
        (item.hooks !== undefined && typeof item.hooks !== 'boolean') ||
        (!item.main && !item.page && !item.hooks)
      )
        throw new Error('Invalid extension registry.');
      ids.add(item.id);
    }
    validateHookManifest(registry, hookManifest);
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
      error: this.runtimeError,
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
      this.confirmations.clear();
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
        await deadline(cleanup(), 1000);
      } catch (cause) {
        errors.push(String(cause));
      }
    }
    for (const layer of Object.keys(item.layers) as (
      | 'main'
      | 'page'
      | 'hooks'
    )[])
      item.layers[layer] = 'disabled';
    item.status = errors.length ? 'error' : 'disabled';
    if (errors.length) {
      item.reloadRequired = true;
      item.reloadReason = 'Resource cleanup failed.';
    }
    item.error = errors.length ? errors.join('\n') : null;
  }
  private async apply(item: ExtensionState) {
    if (!item.enabled || !item.modes.includes('tv') || this.closed) return;
    item.layers = Object.fromEntries(
      (['main', 'page', 'hooks'] as const)
        .filter((layer) => item[layer])
        .map((layer) => [layer, 'starting']),
    );
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
        const cleanup = await deadline(
          start({
            registerRule: (rule) => {
              if (!accepting || item.status === 'error' || this.closed)
                throw new Error('Extension start context is closed.');
              this.dispatcher.register(item.id, rule);
            },
            onCleanup: (cleanup) => {
              if (!accepting) {
                releaseLate(cleanup);
                return;
              }
              resources.push(cleanup);
            },
          }),
          10000,
          releaseLate,
        );
        if (typeof cleanup !== 'function')
          throw new Error('Extension must return cleanup.');
        resources.push(cleanup);
      }
      if (!item.error) {
        if (item.main) item.layers.main = 'active';
        this.aggregate(item);
      }
    } catch (cause) {
      accepting = false;
      await this.stop(item);
      item.error = [String(cause), item.error].filter(Boolean).join('\n');
      item.status = 'error';
      this.revision++;
    } finally {
      accepting = false;
    }
    this.publish();
  }
  private confirmations = new Map<string, string>();
  private aggregate(item: ExtensionState) {
    item.status = item.error
      ? 'error'
      : !item.enabled
        ? 'disabled'
        : Object.values(item.layers).every((status) => status === 'active')
          ? 'active'
          : item.reloadRequired
            ? 'disabled'
            : 'starting';
  }
  resetPage() {
    this.revision++;
    this.confirmations.clear();
    this.runtimeError = null;
    for (const item of this.items) {
      if (!item.page && !item.hooks) continue;
      item.reloadRequired = false;
      item.reloadReason = null;
      for (const layer of ['page', 'hooks'] as const)
        if (item[layer])
          item.layers[layer] = item.enabled ? 'starting' : 'disabled';
      this.aggregate(item);
    }
    this.publish();
  }
  failRuntime(message: string) {
    return this.enqueue(async () => {
      if (this.closed) return;
      this.runtimeError = message.slice(0, 2000);
      this.revision++;
      for (const item of this.items)
        if (item.enabled && (item.page || item.hooks)) {
          item.reloadRequired = true;
          item.reloadReason = 'Extension runtime failed.';
          item.error = this.runtimeError;
          item.status = 'error';
        }
      this.publish();
      for (const item of this.items)
        if (item.enabled && (item.page || item.hooks)) {
          await this.stop(item);
          item.error = [this.runtimeError, item.error]
            .filter(Boolean)
            .join('\n');
          item.status = 'error';
        }
      this.publish();
    });
  }
  reportHook(input: unknown) {
    return this.reportLayer(input, 'hooks');
  }
  reportPage(input: unknown) {
    return this.reportLayer(input, 'page');
  }
  private reportLayer(input: unknown, layer: 'page' | 'hooks') {
    return this.enqueue(async () => {
      if (
        this.closed ||
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 8
      )
        return;
      const value = input as
        | import('./types').HookReport
        | import('./types').PageReport;
      if (
        value.layer !== layer ||
        value.revision !== this.revision ||
        typeof value.document !== 'string' ||
        value.document.length > 100 ||
        typeof value.id !== 'string' ||
        value.id.length > 100 ||
        typeof value.instance !== 'string' ||
        value.instance.length > 100 ||
        !['active', 'disabled', 'error'].includes(value.status) ||
        (value.error !== null &&
          (typeof value.error !== 'string' || value.error.length > 2000)) ||
        (value.reloadReason !== null &&
          (typeof value.reloadReason !== 'string' ||
            value.reloadReason.length > 2000))
      )
        return;
      const item = this.items.find(
        (item) => item.id === value.id && item[layer],
      );
      if (!item) return;
      const key = `${value.document}:${item.id}:${layer}:${value.revision}`;
      const previous = this.confirmations.get(key);
      if (previous !== undefined && previous !== value.instance) return;
      this.confirmations.set(key, value.instance);
      if (value.reloadReason) {
        item.reloadRequired = true;
        item.reloadReason = value.reloadReason;
      }
      if (item.error || (!item.enabled && value.status === 'active')) return;
      if (value.status === 'error') {
        const cause = value.error || 'Extension layer failed.';
        item.error = cause;
        item.status = 'error';
        this.revision++;
        this.confirmations.clear();
        this.publish();
        await this.stop(item);
        item.error = [cause, item.error].filter(Boolean).join('\n');
        item.layers[layer] = 'error';
      } else item.layers[layer] = value.status;
      this.aggregate(item);
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
