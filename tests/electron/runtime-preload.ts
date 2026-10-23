import { startPageRuntime } from '../../src/extensions/page/bootstrap';
startPageRuntime({
  sample: (context) => {
    document.documentElement.dataset.extension = 'active';
    context.onCleanup(() => {
      delete document.documentElement.dataset.extension;
    });
    const callback = context.guard(() => {
      throw new Error('fixture callback failure');
    });
    document.addEventListener('fixture-error', callback);
    return () => document.removeEventListener('fixture-error', callback);
  },
});
