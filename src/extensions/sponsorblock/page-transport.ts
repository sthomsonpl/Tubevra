import type { PageExtensionContext, PageExtensionStart } from '../types';
import {
  sponsorPlaybackStates,
  type PlayerSnapshot,
  type SponsorPlayback,
} from './player';
import {
  SPONSOR_IPC,
  exactObject,
  validSegmentResult,
  validVideoId,
  type GetSponsorSegments,
  type SegmentResult,
  type SponsorLease,
  type SponsorRequest,
} from './contracts';

export interface SponsorConnection {
  ready: Promise<void>;
  updateRevision(revision: number): void;
  getSponsorSegments: GetSponsorSegments;
  dispose(): void;
}
// Owned by SponsorBlock's isolated page adapter. Playback receives the one
// data operation, never invoke(), a token, or the connection's lifecycle controls.
export function createSponsorConnection(
  invoke: (channel: string, payload: unknown) => Promise<unknown>,
  document: string,
  revision: number,
  signal: AbortSignal,
): SponsorConnection {
  let closed = false;
  let desiredRevision = revision;
  let lease: SponsorLease | undefined;
  let sequence = 0;
  const pending = new Map<number, () => void>();
  const control = (channel: string, payload: unknown) => {
    void Promise.resolve()
      .then(() => invoke(channel, payload))
      .catch(() => console.error('SponsorBlock lifecycle IPC failed.'));
  };
  const cancelPending = () => {
    for (const cancel of pending.values()) cancel();
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', dispose);
    cancelPending();
    if (lease) control(SPONSOR_IPC.end, lease);
  };
  signal.addEventListener('abort', dispose, { once: true });
  const connection: SponsorConnection = {
    ready: Promise.resolve().then(async () => {
      if (closed || signal.aborted)
        throw Error('SponsorBlock instance cancelled.');
      const value = await invoke(SPONSOR_IPC.begin, { document, revision });
      if (
        !exactObject(value, ['document', 'revision', 'instance']) ||
        value.document !== document ||
        value.revision !== revision ||
        typeof value.instance !== 'string' ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.instance)
      )
        throw Error('Invalid SponsorBlock instance handshake.');
      lease = value as unknown as SponsorLease;
      if (closed) {
        control(SPONSOR_IPC.end, lease);
        throw Error('SponsorBlock instance cancelled.');
      }
    }),
    updateRevision(next) {
      if (closed || next <= desiredRevision) return;
      desiredRevision = next;
      cancelPending();
      connection.ready = connection.ready
        .catch((cause) => {
          // A later committed revision may supersede a rejected renewal. A failed
          // initial handshake must still fail startup, never fabricate a lease.
          if (!lease) throw cause;
        })
        .then(async () => {
          while (!closed && lease!.revision !== desiredRevision) {
            const renewal = { ...lease!, revision: desiredRevision };
            await invoke(SPONSOR_IPC.renew, renewal);
            lease = renewal;
          }
        });
      void connection.ready.catch(() => {});
    },
    getSponsorSegments(videoId, options) {
      if (!validVideoId(videoId))
        return Promise.reject(TypeError('Invalid video ID.'));
      if (closed || options?.signal?.aborted)
        return Promise.resolve({ kind: 'cancelled' });
      if (pending.size >= 8) return Promise.resolve({ kind: 'busy' });
      if (sequence >= Number.MAX_SAFE_INTEGER)
        return Promise.resolve({ kind: 'busy' });
      const requestId = ++sequence;
      const requestedRevision = desiredRevision;
      return new Promise<SegmentResult>((resolve) => {
        let done = false;
        let sent: SponsorRequest | undefined;
        const finish = (result: SegmentResult) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          options?.signal?.removeEventListener('abort', cancel);
          pending.delete(requestId);
          resolve(result);
        };
        const cancelRequest = (result: SegmentResult) => {
          if (sent) {
            const { videoId: _videoId, ...identity } = sent;
            control(SPONSOR_IPC.cancel, identity);
          }
          finish(result);
        };
        const cancel = () => cancelRequest({ kind: 'cancelled' });
        const timer = setTimeout(
          () => cancelRequest({ kind: 'timeout' }),
          10000,
        );
        pending.set(requestId, cancel);
        options?.signal?.addEventListener('abort', cancel, { once: true });
        void connection.ready
          .then(async () => {
            if (done || closed || desiredRevision !== requestedRevision) {
              finish({ kind: 'cancelled' });
              return;
            }
            sent = { ...lease!, request: requestId, videoId };
            const value = await invoke(SPONSOR_IPC.get, sent);
            if (done) return;
            if (
              !exactObject(value, [
                'document',
                'revision',
                'instance',
                'request',
                'videoId',
                'result',
              ]) ||
              value.document !== sent.document ||
              value.revision !== sent.revision ||
              value.instance !== sent.instance ||
              value.request !== sent.request ||
              value.videoId !== sent.videoId ||
              !validSegmentResult(value.result)
            ) {
              finish({ kind: 'invalid-data' });
              return;
            }
            finish(
              closed || desiredRevision !== requestedRevision
                ? { kind: 'cancelled' }
                : value.result,
            );
          })
          .catch(() =>
            finish(
              closed || desiredRevision !== requestedRevision
                ? { kind: 'cancelled' }
                : { kind: 'service-error' },
            ),
          );
      });
    },
    dispose,
  };
  void connection.ready.catch(() => {});
  if (signal.aborted) dispose();
  return connection;
}

export interface SponsorPageContext extends PageExtensionContext {
  getSponsorSegments: GetSponsorSegments;
  readSponsorPlayer(): PlayerSnapshot;
  reportSponsorPlayback(state: SponsorPlayback): void;
}
export function withSponsorConnection(
  start: (context: SponsorPageContext) => ReturnType<PageExtensionStart>,
  invoke: (channel: string, payload: unknown) => Promise<unknown>,
  readPlayer: () => PlayerSnapshot,
): PageExtensionStart {
  return async (context) => {
    const connection = createSponsorConnection(
      invoke,
      context.documentId,
      context.revision(),
      context.signal,
    );
    context.onCleanup(() => connection.dispose());
    context.onRevision((revision) => connection.updateRevision(revision));
    await connection.ready;
    if (context.signal.aborted) throw Error('SponsorBlock start cancelled.');
    connection.updateRevision(context.revision());
    return start({
      ...context,
      getSponsorSegments: connection.getSponsorSegments,
      readSponsorPlayer: readPlayer,
      reportSponsorPlayback: (state) => {
        if (sponsorPlaybackStates.includes(state))
          context.reportDiagnostics({ playback: state });
      },
    });
  };
}
