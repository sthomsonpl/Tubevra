# Tubevra

[![Czytaj po polsku](https://img.shields.io/badge/PL-Czytaj_po_polsku-2563eb?style=for-the-badge&labelColor=18181b)](readme_pl.md)

An unofficial YouTube client built with Electron and TypeScript for Windows, macOS and Linux.

Still in early development.

## Run

You'll need Node.js 22.13.0 or newer and npm. From the project directory:

```sh
npm install
npm start
```

## Build

Build on the target operating system. `package` creates an application folder; `make` also creates the formats below, including a portable ZIP.

| System / architecture                   | Application folder                                      | Installers + portable                                | Formats           |
| --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| Windows x64                             | `npm run package -- --platform=win32 --arch=x64`        | `npm run make -- --platform=win32 --arch=x64`        | Setup (EXE) + ZIP |
| Windows arm64                           | `npm run package -- --platform=win32 --arch=arm64`      | `npm run make -- --platform=win32 --arch=arm64`      | Setup (EXE) + ZIP |
| macOS Universal (Intel + Apple Silicon) | `npm run package -- --platform=darwin --arch=universal` | `npm run make -- --platform=darwin --arch=universal` | DMG + ZIP         |
| Linux x64                               | `npm run package -- --platform=linux --arch=x64`        | `npm run make -- --platform=linux --arch=x64`        | DEB + RPM + ZIP   |
| Linux arm64                             | `npm run package -- --platform=linux --arch=arm64`      | `npm run make -- --platform=linux --arch=arm64`      | DEB + RPM + ZIP   |

Build DEB/RPM on Linux (native, WSL2, VM or CI) with `dpkg`, `fakeroot`, `rpmbuild` and `zip` in `PATH`. Build macOS Universal and DMG on macOS; code signing and notarization are not configured.

- Application folders: `out/Tubevra-<platform>-<arch>/`.
- Installers: `out/make/nsis/<arch>/`, `out/make/dmg/<arch>/`, `out/make/deb/<arch>/` and `out/make/rpm/<arch>/`.
- Portable ZIPs: `out/make/zip/<platform>/<arch>/`. Extract and run `Tubevra.exe` (Windows), `Tubevra.app` (macOS) or `Tubevra` (Linux), keeping the bundled files together. Data stays in the normal user profile.

## Thanks

Inspired by TizenTube & TizenTube Cobalt. See [third-party notices](THIRD_PARTY_NOTICES.md).

## License

[GPL-3.0-only](LICENSE).

An independent project, not affiliated with Google or YouTube.

Created mainly for educational purposes.
