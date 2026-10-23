import type { ExtensionModule } from '../module';

export const adblock = {
  id: 'adblock',
  name: 'Adblock',
  description:
    'Removes confirmed YouTube TV player ad data. Feed and Shorts ads are not yet supported.',
  modes: ['tv'],
  defaultEnabled: true,
  modules: { hooks: './adblock/hooks.ts' },
} satisfies ExtensionModule;
