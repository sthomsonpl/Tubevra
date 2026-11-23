import type { ExtensionModule } from '../module';

export const qualityRemovalName = 'YouTube Quality Remover';

export const qualityRemoval = {
  id: 'quality-removal',
  name: qualityRemovalName,
  description: 'Removes selected video qualities from the YouTube TV player.',
  modes: ['tv'],
  defaultEnabled: false,
  modules: { hooks: './quality-removal/hooks.ts' },
} satisfies ExtensionModule;
