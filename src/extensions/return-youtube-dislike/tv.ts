// Serialized by Electron: keep this read-only entry self-contained.
export function readRydPlayer() {
  try {
    const player = document.getElementById(
      'ytlr-player__player-container-player',
    ) as HTMLElement & Record<string, any>;
    const id = (v: unknown) =>
      typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
    return {
      videoId: id(player.getVideoData().video_id),
      responseId: id(player.getPlayerResponse()?.videoDetails?.videoId),
      inline: player.isInline() !== false,
      ad: player.getAdState() !== -1 || player.classList.contains('ad-showing'),
    };
  } catch {
    return null;
  }
}
