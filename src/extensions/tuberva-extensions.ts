import { deadline, releaseLate } from './lifecycle';
import { validDiagnostics } from './diagnostics';
import { validateHookManifest } from './hooks/validation';
import type {
  Cleanup,
  ExtensionMetadata,
  ExtensionsState,
  ExtensionState,
  MainExtensionStart,
  ExtensionDiagnostics,
} from './types';
import { ExtensionStore, parseExtensionCommand } from './main/extension-store';
import { RequestDispatcher } from './main/request-dispatcher';
import type { RequestSource } from './main/request-dispatcher';

export class TubervaExtensions {
  private pending: Promise<unknown> = Promise.resolve();
  private items: ExtensionState[];
  private resources = new Map<string, Cleanup[]>();
  private revision = 0;
  private stateVersion = 0;
  private closed = false;
  private runtimeError: string | null = null;
  private dispatcher: RequestDispatcher;
  private authorityListeners = new Set<() => void>();
  private services = new Map<
    string,
    { value: unknown; abort: AbortController }
  >();
  private mainInstances = new Map<string, AbortController>();
  private pageDiagnostics = new Map<
    string,
    (value: ExtensionDiagnostics) => boolean
  >();

  // Independent of diagnostic confirmations. The bridge owns document leases.
  onAuthorityChange(listener: () => void): Cleanup {
    this.authorityListeners.add(listener);
    return () => {
      this.authorityListeners.delete(listener);
    };
  }
  private advanceRevision() {
    this.revision++;
    for (const listener of this.authorityListeners) listener();
  }
  private publishState() {
    this.stateVersion++;
    this.publish();
  }
  getService(id: string) {
    const item = this.items.find((item) => item.id === id);
    return !this.closed &&
      item?.enabled &&
      item.main &&
      item.page &&
      item.modes.includes('tv') &&
      item.status !== 'error' &&
      !item.error &&
      !item.reloadRequired &&
      item.layers.main === 'active'
      ? (this.services.get(id) ?? null)
      : null;
  }
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
      this.advanceRevision();
      item.error = String(cause);
      this.publishState();
      void this.enqueue(async () => {
        await this.stop(item);
        item.error = [String(cause), item.error].filter(Boolean).join('\n');
        item.status = 'error';
        this.publishState();
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
      stateVersion: this.stateVersion,
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
      // Preserve a healthy service and its page connection on duplicate enable.
      // Extensions without a service retain their existing update lifecycle.
      if (item.enabled === command.enabled && this.getService(item.id))
        return this.snapshot();
      await this.store.update(command);
      this.advanceRevision();
      this.confirmations.clear();
      item.enabled = command.enabled;
      await this.stop(item);
      if (!item.error) await this.apply(item);
      this.publishState();
      return this.snapshot();
    });
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(action);
    this.pending = operation.catch(() => {});
    return operation;
  }
  private async stop(item: ExtensionState) {
    const instance = this.mainInstances.get(item.id);
    this.mainInstances.delete(item.id);
    this.services.delete(item.id);
    this.pageDiagnostics.delete(item.id);
    delete item.diagnostics;
    instance?.abort();
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
    this.publishState();
    const resources: Cleanup[] = [];
    this.resources.set(item.id, resources);
    let accepting = true;
    const abort = new AbortController();
    this.mainInstances.set(item.id, abort);
    try {
      if (item.main) {
        const start = this.starts[item.id];
        if (typeof start !== 'function')
          throw new Error('Missing main extension implementation.');
        const cleanup = await deadline(
          start({
            signal: abort.signal,
            registerService: (value) => {
              if (
                !accepting ||
                this.closed ||
                abort.signal.aborted ||
                item.status === 'error' ||
                value == null ||
                this.services.has(item.id)
              )
                throw Error('Extension service registration rejected.');
              this.services.set(item.id, { value, abort });
            },
            registerPageDiagnostics: (validate) => {
              if (
                !accepting ||
                this.closed ||
                abort.signal.aborted ||
                typeof validate !== 'function' ||
                this.pageDiagnostics.has(item.id)
              )
                throw Error('Extension diagnostic registration rejected.');
              this.pageDiagnostics.set(item.id, validate);
            },
            reportDiagnostics: (value) => {
              if (
                this.closed ||
                abort.signal.aborted ||
                this.mainInstances.get(item.id) !== abort ||
                item.status === 'error' ||
                !validDiagnostics(value)
              )
                return;
              item.diagnostics ??= {};
              if (
                JSON.stringify(item.diagnostics.main) === JSON.stringify(value)
              )
                return;
              item.diagnostics.main = { ...value };
              this.publishState();
            },
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
      this.advanceRevision();
    } finally {
      accepting = false;
    }
    this.publishState();
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
    this.advanceRevision();
    this.confirmations.clear();
    this.runtimeError = null;
    for (const item of this.items) {
      if (item.diagnostics) delete item.diagnostics.page;
      if (!item.page && !item.hooks) continue;
      item.reloadRequired = false;
      item.reloadReason = null;
      for (const layer of ['page', 'hooks'] as const)
        if (item[layer])
          item.layers[layer] = item.enabled ? 'starting' : 'disabled';
      this.aggregate(item);
    }
    this.publishState();
  }
  failRuntime(message: string) {
    return this.enqueue(async () => {
      if (this.closed) return;
      this.runtimeError = message.slice(0, 2000);
      this.advanceRevision();
      for (const item of this.items)
        if (item.enabled && (item.page || item.hooks)) {
          item.reloadRequired = true;
          item.reloadReason = 'Extension runtime failed.';
          item.error = this.runtimeError;
          item.status = 'error';
        }
      this.publishState();
      for (const item of this.items)
        if (item.enabled && (item.page || item.hooks)) {
          await this.stop(item);
          item.error = [this.runtimeError, item.error]
            .filter(Boolean)
            .join('\n');
          item.status = 'error';
        }
      this.publishState();
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
        (Object.keys(input).length !== 8 &&
          !(
            layer === 'page' &&
            Object.keys(input).length === 9 &&
            Object.hasOwn(input, 'diagnostics')
          ))
      )
        return;
      const value = input as
        | import('./types').HookReport
        | import('./types').PageReport;
      if (
        'diagnostics' in value &&
        (layer !== 'page' || !validDiagnostics(value.diagnostics))
      )
        return;
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
      if ('diagnostics' in value) {
        const validate = this.pageDiagnostics.get(item.id);
        try {
          if (!validate || !validate(value.diagnostics!)) return;
        } catch {
          return;
        }
      }
      const key = `${value.document}:${item.id}:${layer}:${value.revision}`;
      const previous = this.confirmations.get(key);
      if (previous !== undefined && previous !== value.instance) return;
      this.confirmations.set(key, value.instance);
      if (value.reloadReason) {
        item.reloadRequired = true;
        item.reloadReason = value.reloadReason;
      }
      if (item.error || (!item.enabled && value.status === 'active')) return;
      if ('diagnostics' in value && item.enabled && value.status === 'active') {
        item.diagnostics ??= {};
        item.diagnostics.page = { ...value.diagnostics! };
      }
      if (value.status === 'error') {
        const cause = value.error || 'Extension layer failed.';
        item.error = cause;
        item.status = 'error';
        this.advanceRevision();
        this.confirmations.clear();
        this.publishState();
        await this.stop(item);
        item.error = [cause, item.error].filter(Boolean).join('\n');
        item.layers[layer] = 'error';
      } else item.layers[layer] = value.status;
      this.aggregate(item);
      this.publishState();
    });
  }
  dispose() {
    this.closed = true;
    for (const listener of this.authorityListeners) listener();
    return this.enqueue(async () => {
      for (const item of this.items) await this.stop(item);
      this.dispatcher.dispose();
      this.publishState();
    });
  }
}
