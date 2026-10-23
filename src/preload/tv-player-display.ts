import { contextBridge, ipcRenderer } from 'electron';
import { TV_DISPLAY_IPC, type TVDisplayParameters } from '../shared/tv-display';
import { bootstrapTVDisplay } from './tv-display';

// Main-world entry: keep dependencies inside this function for serialization.
// Observe exported player factories, never minified player internals or global
// Object/JSON functions. Both configuration formats are used by Leanback.
export function overrideTVPlayerDisplay({
  width,
  height,
}: TVDisplayParameters) {
  let failure: string | null = null;
  let calls = 0;
  const watched = new WeakMap<object, Set<string>>();
  const record = (value: unknown): value is Record<string, any> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = (cause: unknown): never => {
    failure ??=
      `TV player display compatibility failed: ${String(cause)}`.slice(0, 1000);
    throw Error(failure);
  };
  function correct(config: unknown, context: unknown) {
    if (config != null && !record(config))
      fail('Invalid player configuration.');
    if (context != null && !record(context)) fail('Invalid player context.');
    const args = record(config) ? config.args : undefined;
    if (args != null && !record(args)) fail('Invalid player arguments.');
    const legacy =
      record(args) && Object.hasOwn(args, 'video_container_override');
    const modern =
      record(context) && Object.hasOwn(context, 'videoContainerOverride');
    if (!legacy && !modern) fail('Unsupported player display configuration.');
    for (const value of [
      ...(legacy ? [args.video_container_override] : []),
      ...(modern ? [context.videoContainerOverride] : []),
    ])
      if (typeof value !== 'string' || !/^[1-9]\d*x[1-9]\d*$/.test(value))
        fail('Invalid player display dimensions.');
    const dpr = window.devicePixelRatio;
    if (!Number.isFinite(dpr) || dpr <= 0) fail('Invalid device pixel ratio.');
    const dimensions = `${Math.round(width / dpr)}x${Math.round(height / dpr)}`;
    calls++;
    return [
      record(config) && record(args)
        ? { ...config, args: { ...args, video_container_override: dimensions } }
        : config,
      record(context)
        ? { ...context, videoContainerOverride: dimensions }
        : context,
    ];
  }
  function factory(value: unknown, configIndex: number, contextIndex: number) {
    if (value == null) return value;
    if (typeof value !== 'function') fail('Invalid player factory.');
    return new Proxy(value as (...args: unknown[]) => unknown, {
      apply(original, receiver, args) {
        const next = [...args];
        try {
          const [config, context] = correct(
            args[configIndex],
            args[contextIndex],
          );
          if (config !== args[configIndex]) next[configIndex] = config;
          if (context !== args[contextIndex]) next[contextIndex] = context;
        } catch (cause) {
          fail(cause);
        }
        // Preserve original exceptions and return values without retrying.
        return Reflect.apply(original, receiver, next);
      },
    });
  }
  function observe(
    target: object,
    key: string,
    transform: (value: any) => unknown,
  ) {
    let keys = watched.get(target);
    if (keys?.has(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (
      descriptor &&
      (!descriptor.configurable ||
        !descriptor.writable ||
        !('value' in descriptor))
    )
      fail(`Cannot observe player export ${key}.`);
    if (!keys) watched.set(target, (keys = new Set()));
    keys.add(key);
    let value = transform(descriptor?.value);
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => value,
      set(next) {
        try {
          value = transform(next);
        } catch (cause) {
          fail(cause);
        }
      },
    });
  }
  function namespace(value: unknown, install: (value: object) => void) {
    if (value == null) return value;
    if (!record(value) && typeof value !== 'function')
      fail('Invalid player namespace.');
    install(value);
    return value;
  }
  observe(window, 'yt', (yt) =>
    namespace(yt, (yt) => {
      observe(yt, 'player', (player) =>
        namespace(player, (player) => {
          observe(player, 'Application', (application) =>
            namespace(application, (application) => {
              observe(application, 'create', (value) => factory(value, 1, 2));
            }),
          );
          observe(player, 'instances', (instances) =>
            namespace(instances, (instances) => {
              observe(instances, 'createFromWebPlayerContextConfig', (value) =>
                factory(value, 2, 1),
              );
            }),
          );
        }),
      );
    }),
  );
  return {
    takeError() {
      if (!calls && !failure) {
        for (const id of [
          'ytlr-player__player-container-player',
          'movie_player',
        ]) {
          const player = window.document.getElementById(id) as any;
          if (typeof player?.getAvailableQualityLevels === 'function')
            failure =
              'TV player display compatibility failed: Unrecognized player factory.';
        }
      }
      const error = failure;
      failure = null;
      return error;
    },
  };
}

export function installTVPlayerDisplay() {
  const parameters = bootstrapTVDisplay();
  if (!parameters) return;
  const report = (cause: unknown) =>
    ipcRenderer.send(TV_DISPLAY_IPC.failure, String(cause).slice(0, 1000));
  try {
    const control = contextBridge.executeInMainWorld({
      func: overrideTVPlayerDisplay,
      args: [parameters],
    });
    const timer = setInterval(() => {
      try {
        const error = control.takeError();
        if (!error) return;
        report(error);
      } catch (cause) {
        report(cause);
      }
      clearInterval(timer);
    }, 250);
    window.addEventListener('pagehide', () => clearInterval(timer), {
      once: true,
    });
  } catch (cause) {
    report(cause);
    throw cause;
  }
}
