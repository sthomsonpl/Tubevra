import type {
  Cleanup,
  PageConfiguration,
  PageExtensionStart,
  PageReport,
} from '../types';

// All callbacks created by a module must use guard; unhandled page exceptions
// cannot reliably be attributed to a particular extension.
export class PageRuntime {
  private revision = -1;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private reloadPending = new Set<string>();
  private instances = new Map<
    string,
    { abort: AbortController; cleanups: Cleanup[]; reload: boolean }
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
    for (const [id, instance] of this.instances)
      if (!config.items.some((item) => item.id === id && item.enabled))
        instance.abort.abort();
    this.pending = this.pending.then(async () => {
      if (this.closed || config.revision !== this.revision) return;
      for (const item of config.items) {
        if (this.closed || config.revision !== this.revision) return;
        let error: string | null = null;
        const reloadOnDisable =
          !item.enabled && this.instances.get(item.id)?.reload;
        if (!item.enabled) error = await this.stop(item.id);
        else {
          if (this.instances.get(item.id)?.abort.signal.aborted)
            await this.stop(item.id);
          if (this.instances.has(item.id)) {
            this.send(
              config,
              item.id,
              this.instances.get(item.id)!.reload
                ? 'reload-required'
                : 'active',
              null,
            );
            continue;
          }
          const instance = {
            abort: new AbortController(),
            cleanups: [] as Cleanup[],
            reload: false,
          };
          this.instances.set(item.id, instance);
          try {
            const start = this.starts[item.id];
            if (!start)
              throw new Error('Missing page extension implementation.');
            const cleanup = await start({
              document: this.document,
              signal: instance.abort.signal,
              onCleanup: (cleanup) => instance.cleanups.push(cleanup),
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
                this.send(
                  { ...config, revision: this.revision },
                  item.id,
                  'reload-required',
                  null,
                );
              },
            });
            if (typeof cleanup !== 'function')
              throw new Error('Extension must return cleanup.');
            instance.cleanups.push(cleanup);
            if (this.closed || instance.abort.signal.aborted)
              await this.stop(item.id);
          } catch (cause) {
            error = [String(cause), await this.stop(item.id)]
              .filter(Boolean)
              .join('\n');
          }
        }
        this.send(
          config,
          item.id,
          error
            ? 'error'
            : reloadOnDisable || this.reloadPending.has(item.id)
              ? 'reload-required'
              : item.enabled
                ? 'active'
                : 'disabled',
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
        document: this.documentId,
        revision: this.revision,
        id,
        status,
        error,
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
    if (this.instances.get(id) && this.instances.get(id) !== instance) return;
    const error = [String(cause), await this.stop(id)]
      .filter(Boolean)
      .join('\n');
    if (!this.closed && revision === this.revision)
      this.report({
        document: this.documentId,
        revision,
        id,
        status: 'error',
        error,
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
        await cleanup();
      } catch (cause) {
        errors.push(String(cause));
      }
    }
    return errors.length ? errors.join('\n') : null;
  }
  dispose() {
    this.closed = true;
    for (const instance of this.instances.values()) instance.abort.abort();
    this.pending = this.pending.then(async () => {
      for (const id of this.instances.keys()) await this.stop(id);
    });
    return this.pending;
  }
}
