import path from 'node:path';
import { MakerBase, type MakerOptions } from '@electron-forge/maker-base';

// The published electron-builder NSIS maker uses the legacy Forge interface.
// Reuse Forge's package without changing its executable or security fuses.
export class MakerNsis extends MakerBase<Record<string, never>> {
  name = 'nsis';
  defaultPlatforms: ['win32'] = ['win32'];

  isSupportedOnCurrentPlatform() {
    return process.platform === 'win32';
  }

  async make({ dir, makeDir, targetArch }: MakerOptions): Promise<string[]> {
    if (targetArch !== 'x64' && targetArch !== 'arm64') {
      throw new Error(
        `Unsupported Windows installer architecture: ${targetArch}`,
      );
    }

    const { build } = await import('app-builder-lib');
    return build({
      prepackaged: dir,
      win: [`nsis:${targetArch}`],
      publish: 'never',
      config: {
        appId: 'com.sthomsonpl.tubevra',
        directories: { output: path.resolve(makeDir, 'nsis', targetArch) },
        artifactName: '${productName}-${version}-win32-${arch}-setup.${ext}',
        publish: null,
        win: {
          icon: path.resolve('assets/icon/icon.ico'),
          // Forge already sets the executable metadata and ASAR integrity.
          signAndEditExecutable: false,
        },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          deleteAppDataOnUninstall: false,
        },
      },
    });
  }
}
