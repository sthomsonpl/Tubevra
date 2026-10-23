# Tubevra

[![Czytaj po polsku](https://img.shields.io/badge/PL-Czytaj_po_polsku-2563eb?style=for-the-badge&labelColor=18181b)](readme_pl.md)

An unofficial YouTube client built with Electron and TypeScript for Windows, macOS and Linux.

Still in early development.

## Run

You'll need Node.js 22.13.0 or newer and npm. From the project directory:

```sh
npm ci
npm start
```

## Build

Build on the target system:

| Build on | Command                             | Installer / archive         |
| -------- | ----------------------------------- | --------------------------- |
| Windows  | `npm run make -- --platform=win32`  | Squirrel installer (`.exe`) |
| macOS    | `npm run make -- --platform=darwin` | ZIP archive                 |
| Linux    | `npm run make -- --platform=linux`  | DEB and RPM packages        |

Creates a portable version in `out/Tubevra-<platform>-<arch>/` and an installer or archive in `out/make/`.

To build only the portable version, use `npm run package`.

Without `--platform`, the current system is used. Architecture defaults to your machine's; add `--arch=x64` or `--arch=arm64` if the target supports it. On Linux, you'll also need `dpkg` and `rpmbuild` in your `PATH`.

## Thanks

Inspired by TizenTube & TizenTube Cobalt. See [third-party notices](THIRD_PARTY_NOTICES.md).

## License

[GPL-3.0-only](LICENSE).

An independent project, not affiliated with Google or YouTube.

Created mainly for educational purposes.
