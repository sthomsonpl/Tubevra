import type {
  HookExtensionStart,
  HookReport,
  PageConfiguration,
} from '../types';

// Shared lifecycle. The build encloses this runtime and module dependencies in hookEntry.
export function createHookRuntime(
  initial: PageConfiguration,
  starts: Readonly<Record<string, HookExtensionStart>>,
) {
  // Validate disabled implementations too, before acquiring any resources.
  const ids = Object.keys(starts);
  if (
    !Array.isArray(initial.hooks) ||
    initial.hooks.length !== ids.length ||
    new Set(initial.hooks.map((item) => item.id)).size !== ids.length ||
    initial.hooks.some((item) => !ids.includes(item.id)) ||
    Object.values(starts).some((start) => typeof start !== 'function')
  )
    throw Error('Hook implementation manifest does not match configuration.');
  let revision = -1;
  let closed = false;
  let sequence = 0;
  const targets = new WeakMap<object, Set<PropertyKey>>();
  const instances = new Map<
    string,
    { instance: string; cleanups: (() => undefined)[]; abort: AbortController }
  >();
  const reload = new Map<string, string>();
  const reports: HookReport[] = [];
  function emit(
    id: string,
    instance: string,
    status: HookReport['status'],
    error: string | null = null,
  ) {
    if (reports.length >= 100) reports.shift();
    reports.push({
      document: initial.document,
      revision,
      id,
      instance,
      layer: 'hooks',
      status,
      error: error?.slice(0, 2000) ?? null,
      reloadReason: reload.get(id) ?? null,
    });
  }
  function stop(id: string) {
    const current = instances.get(id);
    if (!current) return;
    instances.delete(id);
    current.abort.abort();
    const errors: string[] = [];
    for (const cleanup of current.cleanups.reverse()) {
      try {
        if (cleanup() !== undefined)
          throw Error('Hook cleanup must be synchronous.');
      } catch (cause) {
        errors.push(String(cause));
        reload.set(id, 'Hook cleanup failed; a new document is required.');
      }
    }
    emit(
      id,
      current.instance,
      errors.length ? 'error' : 'disabled',
      errors.join('\n') || null,
    );
  }
  function apply(config: PageConfiguration, early = false) {
    if (
      closed ||
      !config ||
      config.document !== initial.document ||
      !Number.isSafeInteger(config.revision) ||
      config.revision <= revision ||
      !Array.isArray(config.hooks) ||
      config.hooks.length > 100
    )
      return;
    if (
      config.hooks.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          typeof item.enabled !== 'boolean',
      ) ||
      new Set(config.hooks.map((item) => item.id)).size !== config.hooks.length
    )
      throw Error('Invalid hook configuration.');
    revision = config.revision;
    for (const id of instances.keys())
      if (!config.hooks.some((item) => item.id === id && item.enabled))
        stop(id);
    for (const item of config.hooks) {
      if (!Object.hasOwn(starts, item.id)) {
        emit(item.id, '', 'error', 'Missing hook implementation.');
        continue;
      }
      const current = instances.get(item.id);
      if (!item.enabled) {
        if (
          !reports.some(
            (report) => report.id === item.id && report.revision === revision,
          )
        )
          emit(item.id, '', 'disabled');
        continue;
      }
      if (current) {
        emit(item.id, current.instance, 'active');
        continue;
      }
      if (!early) {
        reload.set(
          item.id,
          'Hook requires a new document for early installation.',
        );
        emit(item.id, '', 'disabled');
        continue;
      }
      const instance = {
        instance: String(++sequence),
        cleanups: [] as (() => undefined)[],
        abort: new AbortController(),
      };
      instances.set(item.id, instance);
      let accepting = true;
      let failure: string | null = null;
      try {
        const cleanup = starts[item.id]({
          signal: instance.abort.signal,
          wrap(target, key, intercept) {
            if (!accepting) throw Error('Hook installation context is closed.');
            let owned = targets.get(target);
            if (!owned) {
              owned = new Set();
              targets.set(target, owned);
            }
            if (owned.has(key)) throw Error('Conflicting hook target.');
            const descriptor = Object.getOwnPropertyDescriptor(target, key);
            if (
              !descriptor ||
              typeof descriptor.value !== 'function' ||
              !descriptor.configurable
            )
              throw Error('Hook target must be an own configurable function.');
            const original = descriptor.value;
            const wrapper = function (this: unknown, ...args: unknown[]) {
              if (instance.abort.signal.aborted)
                return Reflect.apply(original, this, args);
              let originalThrew = false;
              let originalError: unknown;
              const invokeOriginal = function (
                this: unknown,
                ...values: unknown[]
              ) {
                try {
                  return Reflect.apply(original, this, values);
                } catch (cause) {
                  originalThrew = true;
                  originalError = cause;
                  throw cause;
                }
              };
              // Preserve original exceptions; interceptor failures propagate without retry.
              try {
                return intercept(invokeOriginal, this, args);
              } catch (cause) {
                if (
                  !instance.abort.signal.aborted &&
                  !(originalThrew && Object.is(cause, originalError))
                ) {
                  stop(item.id);
                  emit(item.id, instance.instance, 'error', String(cause));
                }
                throw cause;
              }
            };
            Object.defineProperty(target, key, {
              ...descriptor,
              value: wrapper,
            });
            owned.add(key);
            instance.cleanups.push(() => {
              const current = Object.getOwnPropertyDescriptor(target, key);
              if (
                current?.value !== wrapper ||
                current.configurable !== descriptor.configurable ||
                current.enumerable !== descriptor.enumerable ||
                current.writable !== descriptor.writable
              ) {
                reload.set(
                  item.id,
                  'Hook target changed; restoration would overwrite another owner.',
                );
                throw Error('Hook restoration conflict.');
              }
              Object.defineProperty(target, key, descriptor);
              owned.delete(key);
              return undefined;
            });
          },
          onCleanup(value) {
            if (typeof value !== 'function')
              throw Error('Invalid cleanup registration.');
            if (instance.abort.signal.aborted) {
              if (value() !== undefined)
                throw Error('Hook cleanup must be synchronous.');
            } else instance.cleanups.push(value);
          },
          reportError(message) {
            if (instance.abort.signal.aborted || closed) return;
            failure = String(message);
            if (!accepting) stop(item.id);
            emit(item.id, instance.instance, 'error', failure);
          },
          requireReload(reason) {
            if (instance.abort.signal.aborted || closed) return;
            reload.set(item.id, String(reason).slice(0, 2000));
            if (!accepting) emit(item.id, instance.instance, 'active');
          },
        });
        if (
          typeof cleanup !== 'function' ||
          typeof (cleanup as unknown as { then?: unknown }).then === 'function'
        )
          throw Error('Hook installation must synchronously return cleanup.');
        instance.cleanups.push(cleanup);
        if (failure) {
          stop(item.id);
          emit(item.id, instance.instance, 'error', failure);
        } else emit(item.id, instance.instance, 'active');
      } catch (cause) {
        stop(item.id);
        emit(item.id, instance.instance, 'error', String(cause));
      } finally {
        accepting = false;
      }
    }
  }
  apply(initial, true);
  return {
    apply: (config: PageConfiguration) => apply(config),
    drain: () => reports.splice(0),
    dispose: () => {
      if (closed) return;
      for (const id of instances.keys()) stop(id);
      closed = true;
    },
  };
}
