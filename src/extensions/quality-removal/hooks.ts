import type { HookExtensionStart } from '../types';
import { parseHiddenQualities, qualityRemovalName } from './quality-removal';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function inspectPlayer(value: unknown, hidden: ReadonlySet<number>) {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'playabilityStatus') ||
    !isRecord(value.playabilityStatus) ||
    !Object.hasOwn(value, 'streamingData')
  )
    return;
  const streaming = value.streamingData;
  if (!isRecord(streaming)) throw Error('Unexpected streamingData.');
  const changes: Record<string, unknown[]> = {};
  let hasVideo = false;
  let hasList = false;
  for (const key of ['formats', 'adaptiveFormats'] as const) {
    if (!Object.hasOwn(streaming, key)) continue;
    hasList = true;
    const entries = streaming[key];
    if (!Array.isArray(entries)) throw Error(`Unexpected ${key}.`);
    const kept: unknown[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.mimeType !== 'string')
        throw Error(`Unrecognized entry in ${key}.`);
      if (entry.mimeType.startsWith('video/')) {
        const label =
          typeof entry.qualityLabel === 'string'
            ? /^(\d+)p(?:\d+)?(?:\s+(?:HDR|Premium))*$/i.exec(
                entry.qualityLabel,
              )
            : null;
        if (!label) throw Error(`Unrecognized video quality in ${key}.`);
        if (hidden.has(Number(label[1]))) continue;
        hasVideo = true;
      }
      kept.push(entry);
    }
    if (kept.length !== entries.length) changes[key] = kept;
  }
  if (!hasList) throw Error('Video format lists are missing.');
  if (hasVideo && Object.keys(changes).length)
    return { response: value, streaming: { ...streaming, ...changes } };
}

export const start: HookExtensionStart = (context, options) => {
  let hiddenQualities: number[];
  try {
    hiddenQualities = parseHiddenQualities(options);
  } catch {
    throw Error(`${qualityRemovalName}: invalid hidden resolutions.`);
  }
  if (!hiddenQualities.length) return () => undefined;
  const hidden = new Set<number>(hiddenQualities);
  context.onJsonParsed((result) => {
    try {
      const plan = inspectPlayer(result, hidden);
      if (!plan) return;
      const field = Object.getOwnPropertyDescriptor(
        plan.response,
        'streamingData',
      );
      if (
        !field ||
        !('value' in field) ||
        !field.writable ||
        !Reflect.defineProperty(plan.response, 'streamingData', {
          value: plan.streaming,
        })
      )
        throw Error('Cannot replace streamingData.');
    } catch (cause) {
      context.reportError(`${qualityRemovalName}: ${String(cause)}`);
    }
  });
  return () => undefined;
};
