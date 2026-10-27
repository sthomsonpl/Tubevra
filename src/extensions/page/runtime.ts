import { deadline, releaseLate } from '../lifecycle';
import { validDiagnostics } from '../diagnostics';
import type {
  Cleanup,
  ExtensionDiagnostics,
  PageConfiguration,
  PageExtensionStart,
  PageReport,
} from '../types';

// All callbacks created by a module must use guard; unhandled page exceptions
// cannot reliably be attributed to a particular extension.
export class PageRuntime {
  private sequence = 0;
  private identities = new Map<string, string>();
  private revision = -1;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private reloadPending = new Set<string>();
  private instances = new Map<
    string,
    {
      abort: AbortController;
      cleanups: Cleanup[];
      reload: boolean;
      revisions: Set<(revision: number) => void>;
      diagnostics?: ExtensionDiagnostics;
    }
  >();
  constructor(
    private documentId: string,
    private document: Document,
    private starts: Readonly<Record<string, PageExtensionStart>>,
    private report: (report: PageReport) => void,
  ) {}
  apply(config: PageConfiguration) {
    if (
      this.closed ||
      config.document !== this.documentId ||
      config.revision <= this.revision
    )
      return this.pending;
    this.revision = config.revision;
    // Cancel immediately, even when an asynchronous start is still pending.
    for (const [id, instance] of this.instances) {
      if (!config.items.some((item) => item.id === id && item.enabled))
        instance.abort.abort();
      else
        for (const listener of instance.revisions) {
          try {
            listener(config.revision);
          } catch (cause) {
            void this.fail(id, cause, instance);
          }
        }
    }
    this.pending = this.pending.then(async () => {
      if (this.closed || config.revision !== this.revision) return;
      for (const item of config.items) {
        if (this.closed || config.revision !== this.revision) return;
        let error: string | null = null;
        if (!item.enabled) error = await this.stop(item.id);
        else {
          if (this.instances.get(item.id)?.abort.signal.aborted)
            await this.stop(item.id);
          if (this.instances.has(item.id)) {
            this.send(config, item.id, 'active', null);
            continue;
          }
          const instance: {
            abort: AbortController;
            cleanups: Cleanup[];
            reload: boolean;
            revisions: Set<(revision: number) => void>;
            diagnostics?: ExtensionDiagnostics;
          } = {
            abort: new AbortController(),
            cleanups: [] as Cleanup[],
            reload: false,
            revisions: new Set(),
          };
          this.identities.set(item.id, String(++this.sequence));
          this.instances.set(item.id, instance);
          let installing = true;
          try {
            const start = this.starts[item.id];
            if (!start)
              throw new Error('Missing page extension implementation.');
            const cleanup = await deadline(
              start({
                documentId: this.documentId,
                revision: () => this.revision,
                onRevision: (listener) => {
                  if (!instance.abort.signal.aborted)
                    instance.revisions.add(listener);
                },
                reportDiagnostics: (value) => {
                  if (
                    this.closed ||
                    instance.abort.signal.aborted ||
                    this.instances.get(item.id) !== instance ||
                    !validDiagnostics(value) ||
                    JSON.stringify(instance.diagnostics) ===
                      JSON.stringify(value)
                  )
                    return;
                  instance.diagnostics = { ...value };
                  if (!installing)
                    this.send(
                      { ...config, revision: this.revision },
                      item.id,
                      'active',
                      null,
                    );
                },
                document: this.document,
                signal: instance.abort.signal,
                onCleanup: (cleanup) => {
                  if (instance.abort.signal.aborted) releaseLate(cleanup);
                  else instance.cleanups.push(cleanup);
                },
                guard:
                  (callback) =>
                  (...args) => {
                    if (instance.abort.signal.aborted) return;
                    try {
                      void Promise.resolve(callback(...args)).catch((cause) =>
                        this.fail(item.id, cause, instance),
                      );
                    } catch (cause) {
                      void this.fail(item.id, cause, instance);
                    }
                  },
                requireReload: () => {
                  if (instance.abort.signal.aborted) return;
                  instance.reload = true;
                  this.reloadPending.add(item.id);
                  if (!installing)
                    this.send(
                      { ...config, revision: this.revision },
                      item.id,
                      'active',
                      null,
                    );
                },
              }),
              10000,
              releaseLate,
            );
            installing = false;
            if (typeof cleanup !== 'function')
              throw new Error('Extension must return cleanup.');
            if (this.closed || this.instances.get(item.id) !== instance)
              releaseLate(cleanup);
            else instance.cleanups.push(cleanup);
            if (this.closed || instance.abort.signal.aborted)
              await this.stop(item.id);
          } catch (cause) {
            if (String(cause).includes('timed out'))
              this.reloadPending.add(item.id);
            error = [String(cause), await this.stop(item.id)]
              .filter(Boolean)
              .join('\n');
          }
        }
        this.send(
          config,
          item.id,
          error ? 'error' : item.enabled ? 'active' : 'disabled',
          error,
        );
      }
    });
    return this.pending;
  }
  private send(
    config: PageConfiguration,
    id: string,
    status: PageReport['status'],
    error: string | null,
  ) {
    if (!this.closed && config.revision === this.revision)
      this.report({
        ...(this.instances.get(id)?.diagnostics
          ? { diagnostics: this.instances.get(id)!.diagnostics }
          : {}),
        layer: 'page',
        instance: this.identities.get(id) ?? '',
        reloadReason: this.reloadPending.has(id)
          ? 'Page effects require a new document.'
          : null,
        document: this.documentId,
        revision: this.revision,
        id,
        status,
        error: error?.slice(0, 2000) ?? null,
      });
  }
  private async fail(
    id: string,
    cause: unknown,
    instance: { abort: AbortController },
  ) {
    if (this.instances.get(id) !== instance) return;
    this.instances.get(id)?.abort.abort();
    const revision = this.revision;
    await this.pending;
    if (this.instances.get(id) !== instance) return;
    const error = [String(cause), await this.stop(id)]
      .filter(Boolean)
      .join('\n');
    if (!this.closed && revision === this.revision)
      this.report({
        layer: 'page',
        instance: this.identities.get(id) ?? '',
        reloadReason: this.reloadPending.has(id)
          ? 'Page effects require a new document.'
          : null,
        document: this.documentId,
        revision,
        id,
        status: 'error',
        error: error.slice(0, 2000),
      });
  }
  private async stop(id: string) {
    const instance = this.instances.get(id);
    if (!instance) return null;
    this.instances.delete(id);
    instance.abort.abort();
    const errors: string[] = [];
    for (const cleanup of instance.cleanups.reverse()) {
      try {
        await deadline(cleanup(), 1000);
      } catch (cause) {
        errors.push(String(cause));
        this.reloadPending.add(id);
      }
    }
    return errors.length ? errors.join('\n') : null;
  }
  dispose() {
    this.closed = true;
    for (const instance of this.instances.values()) {
      instance.abort.abort();
      for (const cleanup of instance.cleanups.reverse()) {
        try {
          void Promise.resolve(cleanup()).catch((cause) =>
            console.error('Page shutdown cleanup failed:', cause),
          );
        } catch (cause) {
          console.error('Page shutdown cleanup failed:', cause);
        }
      }
      instance.cleanups.length = 0;
    }
    this.instances.clear();
    return Promise.resolve();
  }
}
