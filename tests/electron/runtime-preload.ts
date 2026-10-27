import { ipcRenderer } from 'electron';
import { withSponsorConnection } from '../../src/extensions/sponsorblock/page-transport';
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
  sponsorblock: withSponsorConnection(
    (context) => {
      if (!context.getSponsorSegments)
        throw Error('Missing SponsorBlock capability');
      document.documentElement.dataset.sponsorStarts = String(
        Number(document.documentElement.dataset.sponsorStarts ?? 0) + 1,
      );
      const request = context.guard(async () => {
        const result = await context.getSponsorSegments!('-lErGZZgUbY');
        if (!context.signal.aborted)
          document.documentElement.dataset.sponsorResult = result.kind;
      });
      // Test-only trigger; no production module listens for this event.
      document.addEventListener('fixture-sponsor-request', request);
      context.onCleanup(() => {
        delete document.documentElement.dataset.sponsorResult;
      });
      request();
      return () =>
        document.removeEventListener('fixture-sponsor-request', request);
    },
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    () => null,
  ),
});
