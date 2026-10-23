import type { ExtensionModule } from '../../../../src/extensions/module';
export const sample = {
  id: 'sample',
  name: 'Fixture',
  description: 'Test only',
  modes: ['tv'],
  defaultEnabled: true,
  modules: { hooks: '../../tests/fixtures/extensions/sample/hooks.ts' },
} satisfies ExtensionModule;
