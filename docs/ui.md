# Tubevra UI

## Local surfaces and blur

The application shell owns the settings and loading/error screens. YouTube
remains a separate sandboxed `WebContentsView`. The toolbar is another local
`WebContentsView` using the same local page at `#toolbar`, above the YouTube view.
No Tubevra DOM, styles or Shadow DOM are inserted into YouTube.

CSS `z-index` in the application shell cannot place its DOM above a native
sibling view. The actual toolbar therefore occupies a bounded 400 × 68 DIP
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
area. Exiting fullscreen restores it. Opening settings hides YouTube, pins the
dock and focuses the local shell; closing settings restores the TV view. A
change of UA while settings are open does not steal the form's focus.

The dock contains Back, Home, Fullscreen and Settings. Fullscreen toggles the native
Electron window, with the icon, label, tooltip and `aria-pressed` following native
window events and F11. The button is disabled while its request is pending. The
dock still auto-hides/reveals in window fullscreen, and settings remain accessible.
F11 ignores modifiers, auto-repeat and IME composition. No new keyboard shortcut
is introduced by the dock button.

The bottom hover strip reveals the dock even when the window is inactive, so
returning from another application does not require an activation click. Hover
does not activate or raise Tubevra, and hiding the dock only restores content
focus inside an already active window. Cursor detection uses screen coordinates:
a covering window can cause the dock to reveal underneath it, while retaining
focus. Minimized/hidden windows and HTML playback fullscreen keep it hidden.
Keyboard navigation keeps the dock visible only while Tubevra is active.

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

## Fullscreen verification on Windows, 2026-10-27

The Electron UI test passed native fullscreen entry/exit through the dock,
F11 on all three surfaces, state updates from native window events, settings
inside window fullscreen, dock bounds and overlapping request handling. Actual
HTML fullscreen on the local fixture also hid and restored the dock. The test
writes `out/verification/ui/fullscreen-report.json` after these checks complete.

Verification used current production Vite bundles in a test-only ASAR with the
installed Electron runtime and a disposable profile. This is a local fixture
check, not live YouTube or a complete distribution-package test. Normal packaging
is blocked by Windows version metadata parsing of the existing `0.2.0-0.dev`
version. The full UI suite stops later at `idle SponsorBlock has no status row`;
the fullscreen checks run before that unrelated scenario. Type checking and
lint/format checks for the changed files pass; repository-wide formatting reports
37 other files. macOS, Linux and physical IME remain unverified.

## Inactive-window dock verification on Windows, 2026-10-27

Run `npm run test:dock` to exercise the current source controller with native
Electron windows and views in a disposable profile. The regression test failed
before the fix when returning the cursor to the inactive window's bottom strip.
After the fix, reveal/hide keeps the other window focused. The test also covers
keyboard visibility, restoring content focus in the active window, covering
windows, minimize/restore, native fullscreen, playback-fullscreen suppression
and settings pinning with a focused input. The report is written to
`out/verification/dock/report.json`.

Cursor coordinates are simulated; focus, views and dock animations use Electron.
The fixture uses always-on-top test windows to ensure their surfaces are painted;
production windows retain their existing behaviour. Playback fullscreen and
settings are exercised through the dock controller's state, without the complete
application or IPC. This is not OS mouse hit testing, a distribution-package test
or live YouTube verification. macOS, Linux and physical IME remain unverified.

## Dock animation ownership

toolbar-auto-hide.ts owns dock visibility, focus and geometry. overlay-animation.ts
owns raster frames, native glass, frame versions, one animation clock and cursor
monitor. tv-window.ts connects them without extension dependencies or IPC/preload
changes. The coordinator supports multiple participants.

Motion replaces native-layer animation with a shared 240 ms easing curve and a
16 ms main-process loop; improved performance under load is not claimed.
The isolated Electron dock test covers the scenarios listed above using simulated
cursor coordinates; the same platform and verification limitations apply.
