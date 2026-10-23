const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface FeedChange {
  owner: Record<string, unknown>;
  field: string;
  items: unknown[];
  path: string;
}

// Deliberately bounded to TV feed lists; never search arbitrary response data.
export function inspectFeedAds(
  value: unknown,
): { changes: FeedChange[] } | { error: string } {
  const changes: FeedChange[] = [];
  let error: string | undefined;
  function visit(
    root: unknown,
    keys: string[],
    prefix = '',
    sections = false,
    rows = true,
  ) {
    let owner = root;
    let path = prefix;
    let recognized = false;
    for (const [index, field] of keys.entries()) {
      path = path ? `${path}.${field}` : field;
      if (!isRecord(owner)) {
        if (recognized) error ??= `Adblock: incompatible feed field ${path}.`;
        return;
      }
      if (!Object.hasOwn(owner, field)) return;
      recognized ||=
        field.endsWith('Renderer') || field.endsWith('Continuation');
      const child: unknown = owner[field];
      if (index !== keys.length - 1) {
        owner = child;
        continue;
      }
      if (!Array.isArray(child)) {
        error ??= `Adblock: incompatible feed field ${path}.`;
        return;
      }
      const items: unknown[] = [];
      let removed = false;
      for (let i = 0; i < child.length; i++) {
        const item: unknown = child[i];
        if (!Object.hasOwn(child, i) || !isRecord(item)) {
          error ??= `Adblock: incompatible feed field ${path}[${i}].`;
          return;
        }
        if (Object.hasOwn(item, 'adSlotRenderer')) {
          if (!isRecord(item.adSlotRenderer)) {
            error ??= `Adblock: incompatible feed field ${path}[${i}].adSlotRenderer.`;
            return;
          }
          removed = true;
          continue;
        }
        items.push(item);
        if (rows)
          visit(
            item,
            ['shelfRenderer', 'content', 'horizontalListRenderer', 'items'],
            `${path}[${i}]`,
            false,
            false,
          );
        if (sections)
          visit(item, ['sectionListRenderer', 'contents'], `${path}[${i}]`);
      }
      if (removed) changes.push({ owner, field, items, path });
    }
  }
  if (!isRecord(value)) return { changes };
  for (const path of [
    'contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents',
    'contents.sectionListRenderer.contents',
    'continuationContents.sectionListContinuation.contents',
    'continuationContents.horizontalListContinuation.items',
    'contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents',
  ])
    visit(value, path.split('.'));
  visit(
    value,
    'contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections'.split(
      '.',
    ),
    '',
    true,
  );
  return error ? { error } : { changes };
}
