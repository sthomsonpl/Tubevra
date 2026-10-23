const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Only the root player signature and ad renderers observed during reconnaissance.
export function inspectPlayerAds(
  value: unknown,
):
  | { response: Record<string, unknown>; fields: string[] }
  | { error: string }
  | undefined {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'playabilityStatus') ||
    !isRecord(value.playabilityStatus) ||
    !Object.hasOwn(value, 'streamingData') ||
    !isRecord(value.streamingData)
  )
    return;

  const fields: string[] = [];
  for (const [field, marker] of [
    ['adPlacements', 'adPlacementRenderer'],
    ['adSlots', 'adSlotRenderer'],
  ]) {
    if (!Object.hasOwn(value, field)) continue;
    const entries = value[field];
    if (!Array.isArray(entries))
      return { error: `Adblock: incompatible player field ${field}.` };
    for (let index = 0; index < entries.length; index++) {
      const entry: unknown = entries[index];
      if (
        !Object.hasOwn(entries, index) ||
        !isRecord(entry) ||
        !Object.hasOwn(entry, marker) ||
        !isRecord(entry[marker])
      )
        return { error: `Adblock: incompatible player field ${field}.` };
    }
    if (entries.length) fields.push(field);
  }
  return { response: value, fields };
}
