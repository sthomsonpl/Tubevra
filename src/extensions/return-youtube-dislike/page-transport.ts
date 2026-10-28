export function createRydConnection(
  invoke: (payload: unknown) => Promise<unknown>,
  document: string,
  initialRevision: number,
  signal: AbortSignal,
  report: (state: 'ready' | 'error') => void = () => {},
) {
  let revision = initialRevision,
    desiredRevision = initialRevision,
    instance = '',
    sequence = 0,
    closed = false;
  const call = (value: ReturnType<typeof payload>) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        dispose();
        reject(Error('RYD IPC timed out.'));
      }, 8000);
      void Promise.resolve()
        .then(() => invoke(value))
        .then(
          (result) => {
            clearTimeout(timer);
            if (
              closed &&
              value.operation === 'begin' &&
              typeof result === 'string'
            ) {
              instance = result;
              void invoke(payload('end')).catch(() =>
                console.error('RYD late cleanup failed.'),
              );
            }
            resolve(result);
          },
          (cause) => {
            clearTimeout(timer);
            reject(cause);
          },
        );
    });
  const payload = (
    operation: string,
    videoId: string | null = null,
    unsupported = false,
  ) => ({
    operation,
    document,
    revision,
    instance,
    sequence: ++sequence,
    videoId,
    unsupported,
  });
  let queue = Promise.resolve().then(async () => {
    if (closed) return;
    const result = await call(payload('begin'));
    if (
      typeof result !== 'string' ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result)
    )
      throw Error('Invalid RYD handshake.');
    instance = result;
  });
  let failed = false;
  const enqueue = (fn: () => Promise<unknown>) => {
    queue = queue
      .then(async () => {
        if (!closed) await fn();
      })
      .catch(() => {
        failed = true;
        report('error');
      });
  };
  const ready = queue;
  void queue.catch(() => {
    failed = true;
    report('error');
  });
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', dispose);
    if (instance)
      void invoke(payload('end')).catch(() =>
        console.error('RYD cleanup failed.'),
      );
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    ready,
    bind(id: string | null, unsupported: boolean) {
      enqueue(async () => {
        if (!failed) await call(payload('bind', id, unsupported));
      });
    },
    renew(next: number) {
      desiredRevision = Math.max(desiredRevision, next);
      enqueue(async () => {
        revision = desiredRevision;
        await call(payload('renew'));
        failed = false;
        report('ready');
      });
    },
    dispose,
  };
}
