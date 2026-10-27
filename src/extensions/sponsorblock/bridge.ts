import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { ExtensionBridgeContext } from '../main/bridge';
import type { TubervaExtensions } from '../tuberva-extensions';
import {
  SPONSOR_IPC,
  type SponsorSegmentsHandler,
  exactObject,
  validVideoId,
  validSegmentResult,
  type SegmentResult,
  type SponsorLease,
  type SponsorRequest,
  type SponsorResponse,
} from './contracts';

// Only a compiled main module can register the handler. No URLs or operation
// names come from the renderer, and diagnostic reports never create a lease.
export function connectSponsorSegments({
  ipc,
  engine,
  trusted,
  currentDocument,
}: ExtensionBridgeContext) {
  type Service = NonNullable<ReturnType<typeof getSponsorService>>;
  let lease: (SponsorLease & { service: Service; lastRequest: number }) | null =
    null;
  let closed = false;
  let windowStart = 0;
  let messages = 0;
  const pending = new Map<number, AbortController>();
  function cancelPending() {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  }
  function revoke() {
    const previous = lease;
    lease = null;
    previous?.service.abort.signal.removeEventListener('abort', revoke);
    cancelPending();
  }
  function service() {
    return getSponsorService(engine);
  }
  const unsubscribe = engine.onAuthorityChange(() => {
    cancelPending();
    if (
      lease &&
      (currentDocument() !== lease.document || service() !== lease.service)
    )
      revoke();
  });
  function ingress(event: IpcMainInvokeEvent, args: unknown[], limited = true) {
    if (closed || !trusted(event) || args.length !== 1)
      throw Error('Untrusted SponsorBlock operation.');
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      messages = 0;
    }
    if (limited && ++messages > 40)
      throw Error('SponsorBlock IPC rate limit exceeded.');
    return args[0];
  }
  function identity(value: Record<string, unknown>, renewing = false) {
    if (
      !lease ||
      value.document !== currentDocument() ||
      value.document !== lease.document ||
      value.instance !== lease.instance ||
      value.revision !== engine.snapshot().revision ||
      (!renewing && value.revision !== lease.revision) ||
      service() !== lease.service
    )
      throw Error('Stale or unavailable SponsorBlock instance.');
    return lease;
  }
  ipc.handle(SPONSOR_IPC.begin, (event, ...args) => {
    const value = ingress(event, args);
    const active = service();
    if (
      !exactObject(value, ['document', 'revision']) ||
      !currentDocument() ||
      value.document !== currentDocument() ||
      value.revision !== engine.snapshot().revision ||
      !active ||
      lease
    )
      throw Error('SponsorBlock instance handshake rejected.');
    lease = {
      document: currentDocument()!,
      revision: engine.snapshot().revision,
      instance: randomUUID(),
      service: active,
      lastRequest: 0,
    };
    active.abort.signal.addEventListener('abort', revoke, { once: true });
    return {
      document: lease.document,
      revision: lease.revision,
      instance: lease.instance,
    };
  });
  ipc.handle(SPONSOR_IPC.renew, (event, ...args) => {
    const value = ingress(event, args);
    if (!exactObject(value, ['document', 'revision', 'instance']))
      throw Error('Invalid SponsorBlock renewal.');
    const active = identity(value, true);
    active.revision = value.revision as number;
  });
  ipc.handle(SPONSOR_IPC.end, (event, ...args) => {
    const value = ingress(event, args, false);
    // A delayed end may close its own old revision, never a replacement instance.
    if (
      !exactObject(value, ['document', 'revision', 'instance']) ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0
    )
      throw Error('Invalid SponsorBlock instance end.');
    if (
      !lease ||
      value.document !== currentDocument() ||
      value.document !== lease.document ||
      value.instance !== lease.instance ||
      (value.revision as number) > lease.revision
    )
      return false;
    revoke();
    return true;
  });
  ipc.handle(SPONSOR_IPC.cancel, (event, ...args) => {
    const value = ingress(event, args, false);
    if (!exactObject(value, ['document', 'revision', 'instance', 'request']))
      throw Error('Invalid SponsorBlock cancellation.');
    if (!Number.isSafeInteger(value.request) || (value.request as number) < 1)
      throw Error('Invalid SponsorBlock request ID.');
    if (
      !lease ||
      value.document !== currentDocument() ||
      value.document !== lease.document ||
      value.instance !== lease.instance ||
      value.revision !== lease.revision ||
      value.revision !== engine.snapshot().revision ||
      service() !== lease.service
    )
      return false;
    pending.get(value.request as number)?.abort();
    return true;
  });
  ipc.handle(
    SPONSOR_IPC.get,
    async (event, ...args): Promise<SponsorResponse> => {
      const value = ingress(event, args);
      if (
        !exactObject(value, [
          'document',
          'revision',
          'instance',
          'request',
          'videoId',
        ])
      )
        throw Error('Invalid SponsorBlock request.');
      const active = identity(value);
      if (
        !validVideoId(value.videoId) ||
        !Number.isSafeInteger(value.request) ||
        (value.request as number) <= active.lastRequest
      )
        throw Error('Invalid or replayed SponsorBlock request.');
      const request = value as unknown as SponsorRequest;
      active.lastRequest = request.request;
      if (pending.size >= 8) return { ...request, result: { kind: 'busy' } };
      const controller = new AbortController();
      pending.set(request.request, controller);
      let finish!: (result: SegmentResult) => void;
      const result = new Promise<SegmentResult>((resolve) => {
        finish = resolve;
      });
      const cancelled = () => finish({ kind: 'cancelled' });
      controller.signal.addEventListener('abort', cancelled, { once: true });
      const timer = setTimeout(() => {
        finish({ kind: 'timeout' });
        controller.abort();
      }, 10000);
      // A handler that ignores cancellation cannot keep the IPC invocation alive.
      void Promise.resolve()
        .then(() => {
          if (controller.signal.aborted)
            return { kind: 'cancelled' } as SegmentResult;
          return active.service.value(request.videoId, controller.signal);
        })
        .then(finish, () => finish({ kind: 'service-error' }));
      try {
        const response = await result;
        const valid =
          !closed &&
          trusted(event) &&
          currentDocument() === request.document &&
          lease === active &&
          active.revision === request.revision &&
          engine.snapshot().revision === request.revision &&
          service() === active.service;
        return {
          ...request,
          result: !valid
            ? { kind: 'cancelled' }
            : validSegmentResult(response)
              ? response
              : { kind: 'invalid-data' },
        };
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancelled);
        if (pending.get(request.request) === controller)
          pending.delete(request.request);
      }
    },
  );
  return {
    invalidate: revoke,
    dispose() {
      closed = true;
      revoke();
      void unsubscribe();
      for (const channel of Object.values(SPONSOR_IPC))
        ipc.removeHandler(channel);
    },
  };
}

function getSponsorService(engine: TubervaExtensions) {
  const service = engine.getService('sponsorblock');
  return service && typeof service.value === 'function'
    ? (service as { value: SponsorSegmentsHandler; abort: AbortController })
    : null;
}
