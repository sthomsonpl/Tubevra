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
duplicated video or an opaque imitation. Application windows are not made always-on-top in production.

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

## Ratings panel

The optional Return YouTube Dislike panel uses a bounded 220 × 68 DIP local
WebContentsView with a dedicated read-only preload. It shares the dock's native
blur, translucent background and corner radius. It moves above the dock in narrow
windows. Full counts remain available to assistive technology.

A confirmed video change reveals loading, then the first result for four seconds.
Hover holds the popup without revealing the dock. The panel also accompanies the
dock; showing either surface never initiates a ratings request. Settings, YouTube
loading/errors, HTML fullscreen and hidden/minimized windows suppress the panel.
Native window fullscreen retains normal dock behaviour.

A window-owned version prevents late results from restoring old counters. Missing
data and errors are text states; zero is a valid count. The native rectangular hit
area includes rounded corners. TV focus is restored only in an active window
outside settings; this is not click-through.

## Verification

Run npm run test:dock and npm run test:ryd:electron for isolated native-view
fixtures. After npm run package, run npm run test:ui and npm run test:ryd:packaged
on Windows x64. Fixtures and simulated
cursor/input do not establish OS hit testing, physical IME, live YouTube playback
or behaviour on macOS/Linux. These require native checks.
