import type { MainExtensionStart } from '../types';
import { createRydCoordinator } from './service';
import { createRydTransport } from './transport';
import { createRydPresentation } from './presentation';
export { connect } from './bridge';

export function createRydStart(
  transport = createRydTransport,
): MainExtensionStart {
  let coordinator: ReturnType<typeof createRydCoordinator> | undefined;
  return (context) => {
    context.registerPageDiagnostics(
      (value) =>
        Object.keys(value).length === 1 &&
        ['ready', 'error'].includes(value.connection),
    );
    coordinator ??= createRydCoordinator(transport());
    const instance = coordinator.start((result) =>
      context.reportDiagnostics({ availability: result.kind }),
    );
    context.onCleanup(instance.dispose);
    context.signal.addEventListener('abort', instance.dispose, { once: true });
    context.onCleanup(() =>
      context.signal.removeEventListener('abort', instance.dispose),
    );
    const presentation = createRydPresentation(instance.get);
    context.onCleanup(
      presentation.subscribe((state) => {
        // Authority listeners run inside a revision change, before the engine
        // updates enabled/layer state. Do not publish a page configuration
        // reentrantly from that intermediate state. Publish only the latest
        // presentation, and let the context reject an aborted instance.
        queueMicrotask(() => {
          if (presentation.snapshot().version === state.version)
            context.reportDiagnostics({ playback: state.kind });
        });
      }),
    );
    context.onCleanup(presentation.dispose);
    context.signal.addEventListener('abort', presentation.dispose, {
      once: true,
    });
    context.onCleanup(() =>
      context.signal.removeEventListener('abort', presentation.dispose),
    );
    context.registerService({ ...instance, ...presentation });
    return instance.dispose;
  };
}
export const start = createRydStart();
