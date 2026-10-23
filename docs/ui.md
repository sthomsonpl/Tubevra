# Tubevra UI

## Local surfaces and blur

The application shell owns the settings and loading/error screens. YouTube
remains a separate sandboxed `WebContentsView`. The toolbar is another local
`WebContentsView` using the same local page at `#toolbar`, above the YouTube view.
No Tubevra DOM, styles or Shadow DOM are inserted into YouTube.

CSS `z-index` in the application shell cannot place its DOM above a native
sibling view. The actual toolbar therefore occupies a bounded 300 × 68 DIP
native surface, centred 20 DIP above the content area's bottom edge. Bounds are
updated from the root view's `bounds-changed` event, including native menu layout
changes. There is no full-window transparent input overlay or mouse forwarding.
As documented by Electron, the rounded cut-out corners still belong to the
rectangular native hit area; all of this area stays within the toolbar footprint.

Electron 45 provides supported native
[`View.setBackgroundBlur`](https://www.electronjs.org/docs/latest/api/view#viewsetbackgroundblurblurradius).
The toolbar uses radius 18, a translucent native background, rounded clipping and
local CSS highlights. This blurs the real content underneath, without screenshots,
duplicated video or an opaque imitation. A local coloured stripe probe on Windows
confirmed that fine stripes are smoothed while broad background colours remain
visible. The unblurred control retains sharp stripes. CSS `backdrop-filter` on a
separate overlay also blurred the background in this specific Windows/Electron 45
probe; that observation does not establish behaviour on other platforms or make
the shell's own DOM rise above YouTube. The implementation uses the native API.

The probe captures only its own test window using `desktopCapturer`; ordinary
`BrowserWindow.capturePage` does not capture all sibling native surfaces. Test
windows are activated because Electron requires a focused parent for native
keyboard input and occluded Windows surfaces may not have a current painted frame.
Application windows are not made always-on-top in production.

HTML fullscreen in the YouTube view hides the native toolbar, including its hit
area. Exiting fullscreen restores it. Opening settings hides both YouTube and the
toolbar and focuses the local shell; closing settings restores the TV view. A
change of UA while settings are open does not steal the form's focus.

## Settings behaviour

- Built-ins have readable names but retain their supplied UA strings verbatim.
  Fields are read-only and edit/delete operations remain blocked in Core.
- Selecting a list item inspects it. Only **Apply preset** changes the active UA.
- **New preset**, **Save changes** and **Delete preset** use the existing validated
  IPC/store. Preset names and UA strings are rendered through text/value properties.
- Unsaved edits disable switching presets; **Discard changes** is explicit.
  Closing and reopening settings keeps the draft. No global keyboard shortcuts
  are installed, so text fields and IME keep normal browser behaviour.
- Deleting an active custom preset requires an explicit replacement choice;
  the confirmation starts with no replacement selected.
- Errors and pending reloads are visible. A committed save or deletion updates the
  editor even if the subsequent TV reload fails; the load error stays visible.
  Failed configuration writes keep the draft. The details panel scrolls when
  the form and deletion confirmation cannot fit together.

## Verification on Windows, 2026-10-23

Passed:

- TypeScript checking and six Core configuration tests.
- Production Windows x64 packaging with Electron Forge.
- Packaged Electron UI integration against a local TV fixture: sandbox/preload
  isolation, built-in protection, custom CRUD, exact UA values, reloads, cookies,
  explicit active-preset replacement, safe text rendering, native Escape dispatch,
  trusted right-click and input/simulated composition guards.
- Actual HTML fullscreen on a fixture video element hides and restores the native
  toolbar. Its bounds and bottom margin are asserted. Settings fit without
  horizontal overflow at the minimum window width and scroll vertically as needed.
- A simulated load failure is displayed while preserving the saved UA selection.
- The real service loaded its `TVHTML5` welcome screen at `youtube.com/tv#/` in
  an isolated profile. No sign-in, consent choice or playback was automated.

Not verified: Back and playback on real Leanback content screens, physical IME,
OS mouse hit testing outside the toolbar, macOS and Linux. Input sent directly to
WebContents in the fixture tests does not prove OS-level hit testing. Full
`npm run lint` reports a formatting issue in the pre-existing `AGENTS.md`; that
file was left unchanged. Targeted lint/format checks cover the changed files.

Run `npm run package`, then `npm run test:ui`. Run `npm run test:glass` for the
local blur comparison. An optional read-only live check is available via
`node tests/electron/run.cjs live-smoke`. These tests use isolated disposable
profiles and do not read or reset the user's Tubevra configuration.
