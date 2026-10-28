import { randomUUID } from 'node:crypto';
import type { ExtensionBridgeContext } from '../main/bridge';
import type { RydPresentation } from './presentation';
import { validVideoId, RYD_IPC } from './contracts';
export function connect({
  ipc,
  engine,
  trusted,
  currentDocument,
}: ExtensionBridgeContext) {
  const service = () => engine.getService('return-youtube-dislike');
  let lease: {
    document: string;
    revision: number;
    instance: string;
    sequence: number;
    service: ReturnType<typeof service>;
  } | null = null;
  let closed = false,
    messages = 0,
    since = 0;
  const presentation = () =>
    lease?.service?.value as RydPresentation | undefined;
  const revoke = () => {
    presentation()?.bind(null);
    lease?.service?.abort.signal.removeEventListener('abort', revoke);
    lease = null;
  };
  const unsubscribe = engine.onAuthorityChange(() => {
    presentation()?.suspend();
    if (
      lease &&
      (currentDocument() !== lease.document || service() !== lease.service)
    )
      revoke();
  });
  ipc.handle(RYD_IPC, (event, ...args) => {
    if (closed || !trusted(event) || args.length !== 1)
      throw Error('Untrusted RYD operation.');
    const v = args[0];
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw Error('Invalid RYD payload.');
    const keys = [
      'operation',
      'document',
      'revision',
      'instance',
      'sequence',
      'videoId',
      'unsupported',
    ];
    if (
      Object.keys(v).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(v, key)) ||
      typeof v.document !== 'string' ||
      v.document.length > 100 ||
      typeof v.instance !== 'string' ||
      v.instance.length > 100 ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 0 ||
      !Number.isSafeInteger(v.sequence) ||
      v.sequence < 1 ||
      (v.videoId !== null && !validVideoId(v.videoId)) ||
      typeof v.unsupported !== 'boolean' ||
      !['begin', 'renew', 'end', 'bind'].includes(v.operation)
    )
      throw Error('Invalid RYD operation.');
    const now = performance.now();
    if (now - since >= 1000) {
      since = now;
      messages = 0;
    }
    if (v.operation !== 'end' && ++messages > 40)
      throw Error('RYD IPC limit exceeded.');
    if (v.operation === 'end') {
      if (
        lease &&
        v.document === lease.document &&
        v.document === currentDocument() &&
        v.instance === lease.instance &&
        v.revision <= lease.revision &&
        v.sequence > lease.sequence
      )
        revoke();
      return null;
    }
    if (
      !currentDocument() ||
      v.document !== currentDocument() ||
      v.revision !== engine.snapshot().revision ||
      !service()
    )
      throw Error('Stale RYD document.');
    if (v.operation === 'begin') {
      if (lease || v.instance !== '') throw Error('RYD handshake rejected.');
      lease = {
        document: v.document,
        revision: v.revision,
        instance: randomUUID(),
        sequence: v.sequence,
        service: service(),
      };
      lease.service!.abort.signal.addEventListener('abort', revoke, {
        once: true,
      });
      return lease.instance;
    }
    if (
      !lease ||
      v.instance !== lease.instance ||
      v.document !== lease.document ||
      v.sequence <= lease.sequence ||
      lease.service !== service()
    )
      throw Error('Stale RYD instance.');
    if (v.operation !== 'renew' && lease.revision !== v.revision)
      throw Error('RYD renewal required.');
    lease.sequence = v.sequence;
    lease.revision = v.revision;
    if (v.operation === 'bind')
      presentation()!.bind(v.videoId, v.unsupported, true);
    return null;
  });
  return {
    invalidate: revoke,
    dispose() {
      closed = true;
      revoke();
      void unsubscribe();
      ipc.removeHandler(RYD_IPC);
    },
  };
}
