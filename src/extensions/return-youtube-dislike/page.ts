import type { PageExtensionStart } from '../types';
import { validVideoId } from './contracts';
import { createRydConnection } from './page-transport';
import type { readRydPlayer } from './tv';

export const startPage =
  (
    invoke: (payload: unknown) => Promise<unknown>,
    read: typeof readRydPlayer,
  ): PageExtensionStart =>
  async (context) => {
    const view = context.document.defaultView;
    if (!view) throw Error('RYD document unavailable.');
    let key = '',
      player: Element | null = null;
    const connection = createRydConnection(
      invoke,
      context.documentId,
      context.revision(),
      context.signal,
      (state) => context.reportDiagnostics({ connection: state }),
    );
    context.onCleanup(connection.dispose);
    await connection.ready;
    if (context.signal.aborted) return connection.dispose;
    context.onRevision((revision) => {
      key = '';
      connection.renew(revision);
      tick();
    });
    const tick = context.guard(() => {
      const current = context.document.getElementById(
        'ytlr-player__player-container-player',
      );
      const route = /^#\/watch\?(.+)$/.exec(view.location.hash);
      const id = route ? new URLSearchParams(route[1]).get('v') : null;
      let sample: ReturnType<typeof readRydPlayer> = null;
      if (validVideoId(id)) {
        try {
          sample = read();
        } catch {
          /* Unsupported player is explicit below. */
        }
      }
      const stable =
        current ===
        context.document.getElementById('ytlr-player__player-container-player');
      const confirmed =
        stable &&
        validVideoId(id) &&
        sample?.videoId === id &&
        sample?.responseId === id &&
        sample?.inline === false &&
        sample?.ad === false;
      const unsupported = validVideoId(id) && !sample;
      const next = confirmed ? id! : unsupported ? 'unsupported' : '';
      if (key === next && player === current) return;
      if (player !== current && key) connection.bind(null, false);
      player = current;
      key = next;
      connection.bind(confirmed ? id! : null, unsupported);
    });
    const routeChanged = context.guard(() => {
      key = '';
      connection.bind(null, false);
      tick();
    });
    const observer = new view.MutationObserver(tick);
    context.onCleanup(() => observer.disconnect());
    observer.observe(context.document, { childList: true, subtree: true });
    const timer = view.setInterval(tick, 250);
    context.onCleanup(() => view.clearInterval(timer));
    view.addEventListener('hashchange', routeChanged);
    context.onCleanup(() =>
      view.removeEventListener('hashchange', routeChanged),
    );
    tick();
    return () => connection.dispose();
  };
