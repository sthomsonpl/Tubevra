# Third-party notices

## SponsorBlock data

Tubevra uses SponsorBlock data from [SponsorBlock](https://sponsor.ajay.app/),
created by Ajay Ramachandran and the contributing community. The API and database
are subject to [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
and the author's [database and API conditions](https://github.com/ajayyy/SponsorBlock/wiki/Database-and-API-License).
See the author's [attribution template](https://gist.github.com/ajayyy/4b27dfc66e33941a45aeaadccb51de71),
[privacy policy](https://gist.github.com/ajayyy/aa9f8ded2b573d4f73a3ffa0ef74f796)
and [service terms](https://gist.github.com/ajayyy/9e8100f069348e0bc062641f34d6af12).

The Tubevra integration is independently authored code under GPL-3.0-only;
no SponsorBlock, TizenTube or other client implementation has been copied.
The data license is separate from Tubevra's code license. Tubevra is a free,
noncommercial project. It requests sponsor/skip ranges for individual YouTube
videos from the official API using a locally computed four-character SHA-256
prefix and exact local matching. No complete database copy is bundled.
Ranges are filtered for playback compatibility and overlapping ranges are
combined locally in memory; Tubevra does not publish a modified database.
Cached segment data is temporary and is not saved as viewing history on disk.

## Inspiration

TizenTube & TizenTube Cobalt inspired Tubevra. No code or modules from these projects are currently integrated.

## Dependencies

Tubevra uses an Electron Forge scaffold with Vite and TypeScript. Dependencies are listed in `package.json`, with exact versions in `package-lock.json`.

Third-party components retain their own licenses. Required license texts, copyright notices and attribution must be preserved in distributions. This document is not a complete dependency license inventory.

### Windows installer tooling

`@electron/packager` 20.3.0 from
[Electron Packager](https://github.com/electron/packager/tree/v20.3.0) is licensed
under BSD-2-Clause, copyright (c) 2015 Max Ogden and other contributors.
`build/patch-packager.mjs`, run by npm's `postinstall`, modifies the installed
`@electron/packager/dist/resedit.js` parser to exclude SemVer prerelease and build
metadata from numeric Windows version fields. Full version strings and the
application's `package.json` version are preserved. The patch checks the tool
version and expected parser text, and must be reviewed when upgrading Packager.
The upstream license is retained at `node_modules/@electron/packager/LICENSE`.

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

## Return YouTube Dislike data

The optional ratings service uses the official API of
[Return YouTube Dislike](https://returnyoutubedislike.com/).
[API usage rights](https://returnyoutubedislike.com/docs/usage-rights) require
attribution and specify per-client limits of 100 requests/minute and 10,000/day.
Tubevra applies stricter local limits and respects server cooldowns. Ratings are
estimates cached only in RAM. The integration is independently authored under
Tubevra's GPL-3.0-only license; no RYD extension code is copied. The extension's
source license is not asserted to be a license for the API database.
