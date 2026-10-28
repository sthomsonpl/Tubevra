# Tubevra Core

## Source structure

```text
src/
  config/user-agents.ts      Supplied, immutable built-in UA values and first-run default
  main/main.ts              Application lifecycle and single-instance lock
  main/tv-window.ts         YouTube view, navigation, permissions and validated IPC
  main/user-agent-store.ts  Configuration validation and serialized atomic writes
  preload/preload.ts        Restricted API for the local application shell
  preload/tv-preload.ts     Isolated TV mouse/IME handling; no API exposed to YouTube
  renderer/                 Local shell, toolbar and settings (see UI notes)
  shared/api.ts             IPC names and the typed application contract
  declarations.d.ts         Renderer and Forge type declarations
tests/core.test.cjs          Configuration tests using Node and the existing TS compiler
```

## User-Agent configuration

The seven built-in values are stored verbatim in `src/config/user-agents.ts`.
The first run explicitly selects `ps4`, the first supplied preset. This is a
first-run default, not a fallback if another preset fails.

Custom presets and the active ID are stored in
`path.join(app.getPath('userData'), 'user-agents.json')`, outside the source tree.
The file has schema version 1. Built-in values are not copied into user data.
Each update is validated and written to a unique sibling temporary file before
atomic replacement. Updates are serialized. Failed writes leave the last
committed state intact; malformed or unsupported configuration is reported and
preserved, with no automatic reset.

The local preload exposes narrow application operations through `window.tubevra`,
including `getState`, `updateUserAgents`, `navigate`, `toggleFullscreen`,
`setSettingsOpen` and `onStateChanged`. User-Agent mutation commands are `add`, `edit`,
`remove` and `select`. Built-ins cannot be edited or removed. Removing an active
custom preset requires an explicit, existing `replacementId`. New custom IDs
are generated in the main process. Names are limited to 100 characters and UA
values to 4096 printable ASCII characters; supplied values are not normalized.

Applying a different active ID or changing its UA value reloads the current
Leanback route using that UA. The persistent `persist:tubevra-tv` session retains
cookies. Client Hints are not overridden. If loading fails, the selected preset
remains saved and the local shell displays the failure; no alternate UA is used.

## TV Back and security

The TV preload captures trusted context-menu events only outside text editing
and IME composition. A narrow IPC notification, accepted only from the YouTube
view's main frame at its TV URL, requests native Escape key-down/key-up events.
The local toolbar uses the same document-side editing guard. No ordinary
keyboard shortcuts, Backspace mapping or browser-history fallback are installed.

TV Back uses native Escape events dispatched to the YouTube view.

Both renderers use `contextIsolation`, sandbox, `webSecurity` and disabled Node
integration. The YouTube preload exposes no application bridge. Settings IPC
requires the local shell's exact WebContents, main frame and URL, and validates
payloads. Remote top-level navigation is restricted to
`https://www.youtube.com/tv` and its subpaths. New windows and other permissions
are denied; fullscreen is allowed for the TV view. External login windows and
non-TV top-level navigation are not supported and produce a visible
message. These limits must be revisited explicitly if a real flow requires them.

## Window fullscreen

The dock button and unmodified F11 share `BrowserWindow.setFullScreen` in the
main process. `windowFullscreen` is read from `isFullScreen`, and native
`enter-full-screen` / `leave-full-screen` events publish state changes, including
changes initiated outside the dock. Overlapping requests share the current
transition; completion waits for the native event (asynchronous on macOS).
Failure to complete within ten seconds is reported visibly. The no-argument IPC
operation accepts only the trusted local shell/toolbar main frames and is removed
when the window closes. YouTube receives no application API.

Window fullscreen is runtime state, not a saved preference. It is separate from
HTML player fullscreen (`playbackFullscreen`), which retains its existing dock
suppression behavior.

## Verification boundary

The Core checks cover types and configuration behavior: persistence, CRUD,
built-in protection, invalid inputs, corrupted files, concurrent updates, failed
atomic replacement and recovery. Run `npm run typecheck` and `npm run test:core`.
Tests use disposable directories under the OS temporary directory, never the
user's application data. A sandbox that forbids renaming temporary files can
prevent the tests from running; it must not be worked around in application code.
