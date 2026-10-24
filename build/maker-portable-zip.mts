import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MakerOptions } from '@electron-forge/maker-base';
import { MakerZIP } from '@electron-forge/maker-zip';

const execFileAsync = promisify(execFile);

export class MakerPortableZIP extends MakerZIP {
  async make(options: MakerOptions): Promise<string[]> {
    if (options.targetPlatform !== 'win32') return super.make(options);

    // cross-zip uses fs.rmdir({ recursive: true }), removed in Node.js 25.
    // Use Windows' ZIP API without modifying global fs behavior or dependencies.
    const { dir, makeDir, targetPlatform, targetArch, packageJSON } = options;
    const zipPath = path.resolve(
      makeDir,
      'zip',
      targetPlatform,
      targetArch,
      `${path.basename(dir)}-${packageJSON.version}.zip`,
    );
    await this.ensureFile(zipPath);
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TUBEVRA_ZIP_SOURCE, $env:TUBEVRA_ZIP_OUTPUT)',
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          TUBEVRA_ZIP_SOURCE: path.resolve(dir),
          TUBEVRA_ZIP_OUTPUT: zipPath,
        },
      },
    );
    return [zipPath];
  }
}
