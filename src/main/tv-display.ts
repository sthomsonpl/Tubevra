import type { Display } from 'electron';
import {
  isTVDisplayParameters,
  isPlaybackResolution,
  type PlaybackResolution,
  type TVDisplayParameters,
} from '../shared/tv-display';

type Monitor = Pick<Display, 'id' | 'bounds' | 'scaleFactor'>;

export function selectTVDisplay(
  displays: readonly Monitor[],
  primaryId: number,
): Readonly<TVDisplayParameters> {
  if (!displays.length || !Number.isSafeInteger(primaryId))
    throw Error('TV display detection failed: no valid display selection.');
  let selected: { id: number; data: TVDisplayParameters } | undefined;
  for (const display of displays) {
    const { width, height } = display.bounds;
    const data = {
      width: Math.round(width * display.scaleFactor),
      height: Math.round(height * display.scaleFactor),
      scaleFactor: display.scaleFactor,
    };
    if (
      !Number.isSafeInteger(display.id) ||
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0 ||
      !isTVDisplayParameters(data)
    )
      throw Error('TV display detection failed: invalid display parameters.');
    const pixels = data.width * data.height;
    const previous = selected ? selected.data.width * selected.data.height : 0;
    if (
      !selected ||
      pixels > previous ||
      (pixels === previous &&
        (display.id === primaryId ||
          (selected.id !== primaryId && display.id < selected.id)))
    )
      selected = { id: display.id, data };
  }
  return Object.freeze(selected!.data);
}

export function resolveTVDisplay(
  display: Readonly<TVDisplayParameters>,
  resolution: PlaybackResolution,
): Readonly<TVDisplayParameters> {
  if (!isTVDisplayParameters(display) || !isPlaybackResolution(resolution))
    throw Error('Invalid playback display parameters.');
  const height =
    resolution === 'auto'
      ? display.height
      : resolution === '1440p'
        ? 1440
        : resolution === '4k'
          ? 2160
          : 4320;
  const result = {
    ...display,
    height,
    width: Math.round((display.width * height) / display.height),
  };
  if (!isTVDisplayParameters(result))
    throw Error('Invalid playback display dimensions.');
  return Object.freeze(result);
}
