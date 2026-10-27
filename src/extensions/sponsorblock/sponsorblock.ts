import type { ExtensionModule } from '../module';

export const sponsorblock = {
  id: 'sponsorblock',
  name: 'SponsorBlock',
  description:
    'Skips sponsors in YouTube TV. Fetches segments from SponsorBlock.',
  modes: ['tv'],
  defaultEnabled: false,
  modules: {
    main: './sponsorblock/main.ts',
    page: './sponsorblock/page-entry.ts',
  },
} satisfies ExtensionModule;
