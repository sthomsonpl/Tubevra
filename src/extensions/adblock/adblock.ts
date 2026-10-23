import type { ExtensionModule } from '../module';

export const adblock = {
  id: 'adblock',
  name: 'Adblock',
  description:
    'Removes YouTube TV player ad data and marked feed ad slots, including banners, rows, continuations and recommendations. Shorts ads are not supported.',
  modes: ['tv'],
  defaultEnabled: true,
  modules: { hooks: './adblock/hooks.ts' },
} satisfies ExtensionModule;
