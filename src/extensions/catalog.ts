import type { ExtensionModule } from './module';
import { adblock } from './adblock/adblock.ts';
import { sponsorblock } from './sponsorblock/sponsorblock.ts';
// Explicitly bundled extensions only. Add each extension's declaration once here.
export const extensionCatalog: readonly ExtensionModule[] = [
  adblock,
  sponsorblock,
];
