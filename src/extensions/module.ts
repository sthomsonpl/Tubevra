import type { ExtensionMetadata } from './types';
export interface ExtensionModule extends Omit<
  ExtensionMetadata,
  'main' | 'page' | 'hooks'
> {
  /** Paths relative to src/extensions. Each module exports start. */
  modules: Partial<Record<'main' | 'page' | 'hooks', string>>;
}
export function createExtensionRegistry(
  catalog: readonly ExtensionModule[],
): readonly ExtensionMetadata[] {
  return Object.freeze(
    catalog.map(({ modules, ...metadata }) => ({
      ...metadata,
      main: !!modules.main,
      page: !!modules.page,
      hooks: !!modules.hooks,
    })),
  );
}
