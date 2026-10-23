import { extensionCatalog } from './catalog';
import { createExtensionRegistry } from './module';
export const extensionRegistry = createExtensionRegistry(extensionCatalog);
export const hookManifest = extensionRegistry
  .filter((item) => item.hooks)
  .map((item) => item.id);
