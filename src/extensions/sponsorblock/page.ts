import type { Cleanup } from '../types';
import type { SponsorPageContext } from './page-transport';
import type { SponsorSegment } from './contracts';
import { playerBlockReason, type SponsorPlayback } from './player';

// Submission lengths and rounded player lengths can differ. One second covers
// the observed 0.44s difference without masking edits in longer films. Targets
// outside the film are rejected, never clipped into a seemingly valid range.
export function usableRanges(
  segments: readonly SponsorSegment[],
  duration: number,
) {
  const ranges: { start: number; end: number }[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      !Number.isFinite(segment.videoDuration) ||
      segment.videoDuration < 0 ||
      segment.start < 0 ||
      segment.end <= segment.start ||
      segment.end > duration ||
      (segment.videoDuration > 0 &&
        Math.abs(segment.videoDuration - duration) > 1)
    )
      continue;
    const previous = ranges.at(-1);
    if (previous && segment.start <= previous.end)
      previous.end = Math.max(previous.end, segment.end);
    else ranges.push({ start: segment.start, end: segment.end });
  }
  return ranges;
}

export const start = (context: SponsorPageContext): Cleanup => {
  const {
    document,
    signal,
    getSponsorSegments,
    readSponsorPlayer,
    reportSponsorPlayback,
  } = context;
  if (!getSponsorSegments || !readSponsorPlayer || !reportSponsorPlayback)
    throw Error('SponsorBlock player capabilities unavailable.');
  const view = document.defaultView;
  if (!view) throw Error('SponsorBlock document window unavailable.');
  type Binding = {
    id: string;
    player: Element;
    video: HTMLVideoElement;
    abort: AbortController;
    segments: SponsorSegment[] | null;
    result: 'pending' | 'segments' | 'empty' | 'error';
    attempted: Set<string>;
    pendingSeek?: {
      target: number;
      from: number;
      position: number;
      deadline: number;
    };
    seekFailed: boolean;
    retries: number;
    retryAt?: number;
  };
  let binding: Binding | undefined;
  let closed = false;
  let evaluating = false;
  const events = [
    'timeupdate',
    'playing',
    'pause',
    'ratechange',
    'seeking',
    'seeked',
    'loadedmetadata',
    'durationchange',
    'emptied',
    'ended',
  ];
  const status = (state: SponsorPlayback) => {
    if (!closed && !signal.aborted) reportSponsorPlayback(state);
  };
  function invalidate() {
    const old = binding;
    binding = undefined;
    if (!old) return;
    old.abort.abort();
    old.video.removeEventListener('seeking', manualSeek);
    for (const name of events) old.video.removeEventListener(name, tick);
  }
  function manualSeek() {
    if (!binding || binding.seekFailed) return;
    const time = binding.video.currentTime;
    if (!Number.isFinite(time)) return;
    // The native setter also emits seeking. Only a different destination
    // interrupts our pending seek; its own events must retain loop protection.
    if (
      binding.pendingSeek &&
      Math.abs(time - binding.pendingSeek.position) <= 0.1
    )
      return;
    binding.pendingSeek = undefined;
    binding.attempted.clear();
  }
  function observe() {
    const player = document.getElementById(
      'ytlr-player__player-container-player',
    );
    const videos = player?.querySelectorAll<HTMLVideoElement>(
      'video.html5-main-video',
    );
    const video = videos?.length === 1 ? videos[0] : null;
    let sample;
    try {
      sample = readSponsorPlayer!();
    } catch {
      sample = null;
    }
    const match = /^#\/watch\?(.+)$/.exec(view!.location.hash);
    const routeId = match ? new URLSearchParams(match[1]).get('v') : null;
    // Page methods can mutate the DOM during the cross-world read.
    const current = document.getElementById(
      'ytlr-player__player-container-player',
    );
    const currentVideos = current?.querySelectorAll('video.html5-main-video');
    const stable =
      player === current &&
      currentVideos?.length === 1 &&
      currentVideos[0] === video;
    const identity =
      !!sample &&
      typeof routeId === 'string' &&
      /^[A-Za-z0-9_-]{11}$/.test(routeId) &&
      sample.routeId === routeId &&
      sample.videoId === routeId &&
      sample.responseId === routeId;
    return {
      player,
      video: stable ? video : null,
      sample,
      id: identity ? routeId : null,
    };
  }
  // Each playback generation owns a bounded retry budget. Polling the deadline
  // avoids timer overflow for long Retry-After values and simplifies teardown.
  function fetchSegments(next: Binding) {
    next.result = 'pending';
    next.retryAt = undefined;
    status('waiting');
    const request = async () => {
      let result = await getSponsorSegments!(next.id, {
        signal: next.abort.signal,
      });
      // A committed configuration revision cancels in-flight IPC while the
      // same page instance survives. Renewed transport may resume once;
      // repeated cancellation never triggers an immediate request loop.
      if (
        result.kind === 'cancelled' &&
        !closed &&
        !signal.aborted &&
        binding === next &&
        !next.abort.signal.aborted
      )
        result = await getSponsorSegments!(next.id, {
          signal: next.abort.signal,
        });
      return result;
    };
    void request()
      .then((result) => {
        if (
          closed ||
          signal.aborted ||
          binding !== next ||
          next.abort.signal.aborted
        )
          return;
        if (result.kind === 'segments') {
          next.segments = result.segments;
          next.result = 'segments';
        } else {
          next.result = result.kind === 'empty' ? 'empty' : 'error';
          const transient = [
            'network-error',
            'service-error',
            'timeout',
            'busy',
            'rate-limited',
          ].includes(result.kind);
          if (transient && next.retries < 3) {
            const delay =
              result.kind === 'rate-limited'
                ? Math.max(1000, result.retryAfterMs)
                : (result.kind === 'busy' ? 2000 : 30000) * 2 ** next.retries;
            next.retries++;
            next.retryAt = view!.performance.now() + delay;
          }
        }
        tick();
      })
      .catch(() => {
        if (binding === next && !closed && !signal.aborted) {
          next.result = 'error';
          status('request-error');
        }
      });
  }
  function evaluate() {
    if (closed || signal.aborted || evaluating) return;
    evaluating = true;
    try {
      const { player, video, sample, id } = observe();
      if (!id || !player || !video) {
        invalidate();
        status(!sample ? 'player-api' : !id ? 'identity' : 'media');
        return;
      }
      if (
        binding &&
        (binding.id !== id ||
          binding.player !== player ||
          binding.video !== video)
      )
        invalidate();
      const blocked = playerBlockReason(sample, video);
      if (blocked) {
        status(blocked);
        return;
      }
      if (!binding) {
        const next: Binding = {
          id,
          player,
          video,
          abort: new AbortController(),
          segments: null,
          result: 'pending',
          attempted: new Set(),
          seekFailed: false,
          retries: 0,
        };
        binding = next;
        video.addEventListener('seeking', manualSeek);
        for (const name of events) video.addEventListener(name, tick);
        fetchSegments(next);
      }
      const active = binding;
      if (
        active.retryAt !== undefined &&
        view!.performance.now() >= active.retryAt
      )
        fetchSegments(active);
      if (active.pendingSeek) {
        const pending = active.pendingSeek;
        if (
          !video.seeking &&
          video.currentTime >= pending.target - 0.1 &&
          video.currentTime > pending.from + 0.05
        ) {
          active.pendingSeek = undefined;
        } else if (view!.performance.now() >= pending.deadline) {
          active.pendingSeek = undefined;
          active.seekFailed = true;
        } else return;
      }
      if (active.seekFailed) {
        status('seek-failed');
        return;
      }
      if (active.result === 'empty') {
        status('empty');
        return;
      }
      if (!active.segments) {
        status(
          active.retryAt !== undefined
            ? 'retrying'
            : active.result === 'error'
              ? 'request-error'
              : 'waiting',
        );
        return;
      }
      const ranges = usableRanges(active.segments, video.duration);
      if (!ranges.length && active.segments.length) {
        status('invalid-segments');
        return;
      }
      status(ranges.length ? 'ready' : 'empty');
      if (video.paused || video.ended || video.seeking) return;
      const range = ranges.find(
        (range) =>
          video.currentTime >= range.start && video.currentTime < range.end,
      );
      if (!range) return;
      const key = `${range.start}:${range.end}`;
      if (active.attempted.has(key)) return;
      if (
        !Array.from(
          { length: video.seekable.length },
          (_, index) => index,
        ).some(
          (index) =>
            range.end >= video.seekable.start(index) &&
            range.end <= video.seekable.end(index),
        )
      ) {
        status('not-ready');
        return;
      }
      // No await between final revalidation and the native media write.
      const final = observe();
      const reason = playerBlockReason(final.sample, final.video);
      if (
        closed ||
        signal.aborted ||
        binding !== active ||
        active.abort.signal.aborted ||
        final.id !== id ||
        final.video !== video ||
        final.player !== player
      ) {
        invalidate();
        status('identity');
        return;
      }
      if (reason) {
        status(reason);
        return;
      }
      if (
        video.paused ||
        video.ended ||
        video.currentTime < range.start ||
        video.currentTime >= range.end ||
        !usableRanges(active.segments, video.duration).some(
          (candidate) =>
            candidate.start === range.start && candidate.end === range.end,
        ) ||
        !Array.from(
          { length: video.seekable.length },
          (_, index) => index,
        ).some(
          (index) =>
            range.end >= video.seekable.start(index) &&
            range.end <= video.seekable.end(index),
        )
      )
        return;
      active.attempted.add(key);
      const pendingSeek = {
        target: range.end,
        from: video.currentTime,
        position: range.end,
        deadline: view!.performance.now() + 4000,
      };
      active.pendingSeek = pendingSeek;
      try {
        video.currentTime = range.end;
        // Read back the applied position: an ignored or rounded write must not
        // look like a manual interruption when its native events arrive.
        if (active.pendingSeek === pendingSeek)
          pendingSeek.position = video.currentTime;
      } catch {
        active.pendingSeek = undefined;
        active.seekFailed = true;
        status('seek-failed');
      }
    } finally {
      evaluating = false;
    }
  }
  const tick = context.guard(evaluate);
  const routeChanged = context.guard(() => {
    invalidate();
    evaluate();
  });
  let observer: MutationObserver | undefined;
  let timer: number | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    invalidate();
    observer?.disconnect();
    if (timer !== undefined) view.clearInterval(timer);
    view.removeEventListener('hashchange', routeChanged);
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  context.onCleanup(dispose);
  if (signal.aborted) dispose();
  if (!closed) {
    view.addEventListener('hashchange', routeChanged);
    observer = new view.MutationObserver(
      context.guard(() => {
        if (
          binding &&
          (document.getElementById('ytlr-player__player-container-player') !==
            binding.player ||
            binding.player.querySelectorAll('video.html5-main-video').length !==
              1 ||
            binding.player.querySelector('video.html5-main-video') !==
              binding.video)
        ) {
          invalidate();
          tick();
        }
      }),
    );
    observer.observe(document, { childList: true, subtree: true });
    // Bounded sampling catches autoplay and API changes without route events.
    timer = view.setInterval(tick, 250);
    tick();
  }
  return dispose;
};
