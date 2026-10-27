import { randomUUID } from 'node:crypto';
import { net, session } from 'electron';

export type SponsorTransportResult =
  | { kind: 'response'; status: number; retryAfter?: string; body: Uint8Array }
  | {
      kind:
        | 'network-error'
        | 'cancelled'
        | 'timeout'
        | 'invalid-data'
        | 'service-error'
        | 'busy';
    };
export type SponsorTransport = (
  prefix: string,
  signal: AbortSignal,
) => Promise<SponsorTransportResult>;

const MAX_BODY = 1024 * 1024;
let isolatedSession: Electron.Session | undefined;

// The compiled main module supplies a hash prefix only. This dedicated session
// is never shared with YouTube or exposed to any renderer.
export function createSponsorTransport(): SponsorTransport {
  const isolated = (isolatedSession ??= session.fromPartition(
    `tubevra-sponsor-${randomUUID()}`,
    { cache: false },
  ));
  return (prefix, signal) => {
    if (!/^[0-9a-f]{4}$/.test(prefix))
      return Promise.resolve({ kind: 'invalid-data' });
    if (signal.aborted) return Promise.resolve({ kind: 'cancelled' });
    const url = new URL(`https://sponsor.ajay.app/api/skipSegments/${prefix}`);
    url.searchParams.set('categories', JSON.stringify(['sponsor']));
    url.searchParams.set('actionTypes', JSON.stringify(['skip']));
    url.searchParams.set('service', 'YouTube');
    return new Promise<SponsorTransportResult>((resolve) => {
      let request: Electron.ClientRequest | undefined;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: SponsorTransportResult, abort = false) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (abort) request?.abort();
        resolve(result);
      };
      const cancel = () => finish({ kind: 'cancelled' }, true);
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish({ kind: 'timeout' }, true), 10000);
      try {
        request = net.request({
          method: 'GET',
          url: url.href,
          session: isolated,
          credentials: 'omit',
          // Manual mode cancels every redirect unless followRedirect() is called;
          // the only handler below always rejects it and never follows it.
          redirect: 'manual',
          bypassCustomProtocolHandlers: true,
          headers: { Accept: 'application/json' },
        });
        request.on('error', () => finish({ kind: 'network-error' }));
        request.on('redirect', () => finish({ kind: 'service-error' }, true));
        request.on('login', (_auth, callback) => callback());
        request.on('response', (response) => {
          if (done) return;
          response.on('error', () => finish({ kind: 'network-error' }, true));
          response.on('aborted', () => finish({ kind: 'network-error' }));
          const retry = response.headers['retry-after'];
          const retryAfter = typeof retry === 'string' ? retry : undefined;
          if (response.statusCode !== 200) {
            finish(
              {
                kind: 'response',
                status: response.statusCode,
                retryAfter,
                body: new Uint8Array(),
              },
              true,
            );
            return;
          }
          const length = response.headers['content-length'];
          if (
            typeof length === 'string' &&
            /^\d+$/.test(length) &&
            Number(length) > MAX_BODY
          ) {
            finish({ kind: 'invalid-data' }, true);
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          // Install end before data, as required by Electron's IncomingMessage.
          response.on('end', () =>
            finish({
              kind: 'response',
              status: 200,
              body: Buffer.concat(chunks, size),
            }),
          );
          response.on('data', (chunk) => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_BODY) {
              finish({ kind: 'invalid-data' }, true);
              return;
            }
            chunks.push(chunk);
          });
        });
        if (signal.aborted) cancel();
        else request.end();
      } catch {
        finish({ kind: 'network-error' }, true);
      }
    });
  };
}
