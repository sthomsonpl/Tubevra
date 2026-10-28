import type { ExtensionModule } from '../module';

export const ryd = {
  id: 'return-youtube-dislike',
  name: 'Return YouTube Dislike',
  description: 'Estimated likes and dislikes in the dock ratings panel.',
  modes: ['tv'],
  defaultEnabled: false,
  modules: {
    main: './return-youtube-dislike/main.ts',
    page: './return-youtube-dislike/page-entry.ts',
  },
} satisfies ExtensionModule;
