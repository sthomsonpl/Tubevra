// A stateless, read-only main-world entry. Keep the body self-contained: Electron
// serializes this function. No capabilities, player objects or callable methods
// cross back to the isolated module.
export function readPlayerSnapshot() {
  try {
    const player = document.getElementById(
      'ytlr-player__player-container-player',
    ) as (HTMLElement & Record<string, any>) | null;
    const read = (name: string) => {
      if (typeof player?.[name] !== 'function')
        throw Error('Player API missing');
      return player[name]();
    };
    const id = (value: unknown) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value)
        ? value
        : null;
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const boolean = (value: unknown) =>
      typeof value === 'boolean' ? value : null;
    const data = read('getVideoData');
    const response = read('getPlayerResponse');
    const progress = read('getProgressState');
    const route = /^#\/watch\?(.+)$/.exec(location.hash);
    const declared = response?.videoDetails?.lengthSeconds;
    return {
      routeId: route ? id(new URLSearchParams(route[1]).get('v')) : null,
      videoId: id(data?.video_id),
      responseId: id(response?.videoDetails?.videoId),
      live: boolean(data?.isLive),
      windowedLive: boolean(data?.isWindowedLive),
      liveContent: boolean(response?.videoDetails?.isLiveContent),
      inline: boolean(read('isInline')),
      adState: number(read('getAdState')),
      adClass: player?.classList.contains('ad-showing') === true,
      state: number(read('getPlayerState')),
      time: number(read('getCurrentTime')),
      duration: number(read('getDuration')),
      declaredDuration:
        typeof declared === 'string' && /^\d{1,10}$/.test(declared)
          ? number(Number(declared))
          : null,
      allowSeeking: boolean(progress?.allowSeeking),
      offset: number(progress?.offset),
      playable: response?.playabilityStatus?.status === 'OK',
    };
  } catch {
    return null;
  }
}

export type PlayerSnapshot = ReturnType<typeof readPlayerSnapshot>;

export const sponsorPlaybackStates = [
  'waiting',
  'retrying',
  'request-error',
  'ready',
  'empty',
  'player-api',
  'identity',
  'media',
  'live',
  'preview',
  'ad',
  'timeline',
  'not-ready',
  'invalid-segments',
  'seek-failed',
] as const;
export type SponsorPlayback = (typeof sponsorPlaybackStates)[number];

// Validate again in the isolated world. Main-world observations are untrusted.
export function playerBlockReason(
  sample: PlayerSnapshot,
  video: HTMLVideoElement | null,
): SponsorPlayback | null {
  if (!sample || typeof sample !== 'object') return 'player-api';
  if (
    typeof sample.routeId !== 'string' ||
    !/^[A-Za-z0-9_-]{11}$/.test(sample.routeId) ||
    sample.routeId !== sample.videoId ||
    sample.routeId !== sample.responseId
  )
    return 'identity';
  if (!video) return 'media';
  if (
    sample.live !== false ||
    sample.windowedLive !== false ||
    sample.liveContent !== false
  )
    return 'live';
  if (sample.inline !== false) return 'preview';
  if (sample.adState !== -1 || sample.adClass !== false) return 'ad';
  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if (
    sample.offset !== 0 ||
    sample.allowSeeking !== true ||
    !finite(sample.time) ||
    !finite(sample.duration) ||
    !finite(sample.declaredDuration) ||
    !finite(video.currentTime) ||
    !finite(video.duration) ||
    sample.duration <= 0 ||
    sample.declaredDuration <= 0 ||
    video.duration <= 0 ||
    sample.time < 0 ||
    sample.time > sample.duration ||
    video.currentTime < 0 ||
    video.currentTime > video.duration ||
    Math.abs(sample.time - video.currentTime) > 0.5 ||
    Math.abs(sample.duration - video.duration) > 1 ||
    Math.abs(sample.declaredDuration - video.duration) > 1
  )
    return 'timeline';
  if (
    sample.playable !== true ||
    ![1, 2].includes(sample.state!) ||
    video.readyState < 2 ||
    video.seeking
  )
    return 'not-ready';
  return null;
}
