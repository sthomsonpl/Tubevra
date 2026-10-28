import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerNsis } from './build/maker-nsis.mts';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerPortableZIP } from './build/maker-portable-zip.mts';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['LICENSE', 'THIRD_PARTY_NOTICES.md'],
    appBundleId: 'com.sthomsonpl.tubevra',
    icon: './assets/icon/icon',
    osxUniversal: { mergeASARs: true },
    // Defer ad-hoc signing until after the Universal slices have been merged.
    // Otherwise the fuses plugin signs only arm64, adding unmatched resources.
    osxSign: {
      identity: '-',
      identityValidation: false,
      optionsForFile: () => ({
        timestamp: 'none',
        hardenedRuntime: true,
        entitlements: [
          'com.apple.security.cs.allow-jit',
          // Ad-hoc signatures have no Team ID for library validation. Remove
          // this exception when switching to a Developer ID certificate.
          'com.apple.security.cs.disable-library-validation',
        ],
      }),
      continueOnError: false,
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerNsis({}),
    new MakerDMG({ format: 'ULFO' }, ['darwin']),
    new MakerPortableZIP({}, ['win32', 'darwin', 'linux']),
    // The packaged executable uses productName's case, not package.json's name.
    new MakerRpm({ options: { bin: 'Tubevra' } }),
    new MakerDeb({ options: { bin: 'Tubevra' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/preload/ratings-preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/preload/tv-preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
