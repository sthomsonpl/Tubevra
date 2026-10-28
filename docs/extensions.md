# TubervaExtensions

## Adding an extension

1. Create a directory under src/extensions/, for example adblock/.
2. Put its declaration in adblock.ts: id, name, description, modes,
   defaultEnabled and modules.
3. Keep its implementations and helpers in that directory. Each implementation
   exports start using the corresponding contract from types.ts.
4. Import the declaration with an explicit .ts extension and add it once to
   extensionCatalog in src/extensions/catalog.ts.

Module paths are relative to src/extensions. For example,
modules: { hooks: './adblock/hooks.ts' } declares a hook implementation.
The registry, hook manifest and layer maps are derived from the catalog.

## Execution

- main: request rules and resources managed by the main process.
- page: document modules managed by the isolated preload.
- hooks: early interception in the page's JavaScript world.

build/extensions.mjs assembles hook modules and their imported helpers inside
one serializable hookEntry function. Main receives metadata and hook IDs without
importing hook implementations. External hook dependencies are rejected.

Modules must register cleanup when acquiring resources and respect cancellation.
Hooks install and clean up synchronously. Late enabling requires a new document;
irreversible effects must request an explicit reload.

## Settings and tests

Enablement is saved in extensions.json, with defaultEnabled used for missing
preferences. Runtime status, errors and reload requirements are tracked separately.
Toggling never reloads the document automatically.

Test modules live in tests/fixtures/extensions/ and use the same build mechanism
with a separate catalog. Run npm run test:extensions, npm run test:runtime and
the Electron integration scripts to verify changes.

## Return YouTube Dislike

Disabled by default and available in TV mode. The adapter confirms the watch route
against player IDs, excludes ads and inline previews, and detects autoplay.
The main process fetches estimated likes and dislikes from the official API using
an isolated session, bounded RAM cache and rate limits. No votes are sent.

A private document/revision/instance protocol binds each video. Navigation,
renderer loss and disabling cancel pending work and clear the panel. Late results
cannot replace the current video's ratings. Each generation permits at most two
retries for transient errors, respecting cache and server cooldowns.

The local panel accompanies the dock and briefly appears after a video change.
Revealing it does not initiate HTTP. See [UI](ui.md), [privacy](../PRIVACY.md)
and [attribution](../THIRD_PARTY_NOTICES.md).

Run npm run test:ryd, npm run test:ryd:electron and, after packaging,
npm run test:ryd:packaged (Windows x64). Fixture tests do not verify live YouTube
compatibility or physical mouse/IME interactions.
