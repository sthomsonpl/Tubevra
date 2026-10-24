# Third-party notices

## Inspiration

TizenTube & TizenTube Cobalt inspired Tubevra. No code or modules from these projects are currently integrated.

## Dependencies

Tubevra uses an Electron Forge scaffold with Vite and TypeScript. Dependencies are listed in `package.json`, with exact versions in `package-lock.json`.

Third-party components retain their own licenses. Required license texts, copyright notices and attribution must be preserved in distributions. This document is not a complete dependency license inventory.

### Windows installer tooling

The Windows installer uses `app-builder-lib` 26.15.3 from
[electron-builder](https://github.com/electron-userland/electron-builder), licensed
under MIT, and its NSIS installer tooling. `@electron-forge/maker-base` 8.0.1 is
also MIT-licensed. Exact dependency versions are recorded in `package-lock.json`.
`build/maker-nsis.mts` is a Tubevra adapter that calls the library's `build`
API with the existing Forge package and assisted-installer options; no external
source files have been copied or modified. Preserve the upstream license notices
supplied with these tools and their generated installer resources.

If external code is integrated, record its source, version, affected files and modifications here, along with the required license and attribution notices.

### macOS installer tooling

macOS disk images use the MIT-licensed `@electron-forge/maker-dmg` 8.0.1 from
[Electron Forge](https://github.com/electron/forge) and its installer dependencies.
The maker is configured in `forge.config.mts`; no upstream source files have been
copied or modified. The macOS icon is a format conversion of Tubevra's existing
Windows icon.

### Portable archives

`build/maker-portable-zip.mts` extends the MIT-licensed Electron Forge ZIP maker.
It uses the Windows ZIP API on Windows because `cross-zip` 4.0.1 calls an API
removed in Node.js 25; other platforms retain the upstream implementation.
No upstream source files have been copied or modified.
