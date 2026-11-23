import type { ExtensionModule } from '../module';

export const qualityRemovalName = 'YouTube Quality Remover';
export const qualityRemovalId = 'quality-removal';
export const qualityResolutions: readonly number[] = [144, 240, 360, 480];

/** Validates a saved selection and returns it sorted, so equal choices compare equal. */
export function parseHiddenQualities(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > qualityResolutions.length ||
    value.some((entry) => !qualityResolutions.includes(entry)) ||
    new Set(value).size !== value.length
  )
    throw Error('Invalid hidden resolutions.');
  return [...value].sort((a: number, b: number) => a - b);
}

export const qualityRemoval = {
  id: qualityRemovalId,
  name: qualityRemovalName,
  description: 'Removes selected video qualities from the YouTube TV player.',
  modes: ['tv'],
  defaultEnabled: false,
  modules: { hooks: './quality-removal/hooks.ts' },
} satisfies ExtensionModule;
