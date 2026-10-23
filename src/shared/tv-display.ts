export interface TVDisplayParameters {
  /** Configured output resolution in physical pixels, not CSS pixels. */
  width: number;
  height: number;
  scaleFactor: number;
}

export const TV_DISPLAY_IPC = Object.freeze({
  bootstrap: 'tubevra:tv-display:bootstrap',
  failure: 'tubevra:tv-display:failure',
});

export function isTVDisplayParameters(
  value: unknown,
): value is TVDisplayParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as TVDisplayParameters;
  return (
    Object.keys(data).length === 3 &&
    Object.hasOwn(data, 'width') &&
    Object.hasOwn(data, 'height') &&
    Object.hasOwn(data, 'scaleFactor') &&
    Number.isSafeInteger(data.width) &&
    data.width > 0 &&
    Number.isSafeInteger(data.height) &&
    data.height > 0 &&
    Number.isSafeInteger(data.width * data.height) &&
    Number.isFinite(data.scaleFactor) &&
    data.scaleFactor > 0
  );
}

export function isTVDisplayURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://www.youtube.com' &&
      (url.pathname === '/tv' || url.pathname.startsWith('/tv/'))
    );
  } catch {
    return false;
  }
}
