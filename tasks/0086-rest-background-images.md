# 0086 — Nature background images in rest mode

Status: done

## Goal

Rest mode is a plain dark screen with a countdown. A calm nature image behind the
break clock gives the eyes somewhere soft to land and makes the rest feel like a
real pause instead of another app screen. Add an optional **background image to the
rest/break screen** (`renderBreak` in `views.ts`):

- A small set of **bundled nature photos** (forest, coast, mountains, rain…) that work
  offline out of the box.
- **Load your own image** from a file.
- **Separate night and light images** for user-provided backgrounds, so a dark photo
  shows in night mode and a bright one in day mode (a single image can also be tagged
  for both).
- Controls for how strong and how soft the image is (dim + blur) so the clock always
  stays readable.
- **Off by default** — the current rest screen is unchanged until the user turns it on.

## Model

### Built-in backgrounds (`public/backgrounds/*`)

Bundle one optimized file per image and a catalog in `src/backgrounds.ts`:

- Formats: **self-contained SVG illustrations** (tiny, license-free, no network) served
  from `public/backgrounds/`. Photos can be dropped in later without code changes; the
  catalog just points at a URL. (The original plan called for WebP/JPEG photos; SVG was
  chosen so the feature ships with zero licensing/attribution and negligible weight.)
- Size budget: each scene is only a few KB. Ship **8** scenes: `forest-stream`,
  `misty-pines`, `ocean-waves`, `mountain-lake`, `meadow`, `rain-leaves`,
  `desert-dunes`, `night-sky`.
- Catalog entry: `{ id, label, src, credit, suggestedMode: "dark" | "light" | "both" }`.
  `suggestedMode` is only a hint for the picker (a dusk forest leans dark, a bright
  meadow leans light); the user can still place any image in either slot.
- `credit` is surfaced as a small "Photo credits" line under the settings preview.

### Settings

Add to `Settings` (`types.ts`) and `DEFAULT_SETTINGS`:

- `restBackgroundDark: string` — the dark-mode background: `"none"` (default) · a
  built-in id · `"custom:<uuid>"`.
- `restBackgroundLight: string` — the light-mode background: `"none"` (default) · a
  built-in id · `"custom:<uuid>"`.
- `restBackgroundDim: number` — scrim strength, `0..100`, default `45`.
- `restBackgroundBlur: number` — CSS blur px, `0..20`, default `0`.
- `customBackgrounds: BackgroundImage[]` — metadata for imported images
  (`{ id, name, addedAt, mode }`), capped at ~10. `mode` is `"dark" | "light" | "both"`
  and describes which theme mode the photo was chosen for. Image **bytes are not kept
  in settings**; see storage below.

The two slots are what let a user "differentiate night/light images": the rest screen
uses `restBackgroundDark` while `themeMode === "dark"` and `restBackgroundLight` while
`themeMode === "light"`. Either slot may point at the same built-in or custom image when
the user wants one image for both.

`sanitizeSettings` (`storage.ts`) must validate the new fields: unknown background ids
(slot values and each custom id) → `"none"`/dropped, clamp dim/blur into range, and
sanity-check each `customBackgrounds` entry (drop malformed/huge/duplicate entries,
default `mode` to `"both"` if missing/invalid). Repeated `customBackgrounds` ids are
de-duplicated. Export/import and backups round-trip the settings fields (image bytes
excluded — see Nice to have).

### Custom image storage

LocalStorage is too small for photos, so store imported image bytes separately:

- Use a dedicated **IndexedDB** database/store (e.g. `ultradiandrift` →
  `backgrounds`) keyed by the custom id, holding a `Blob`/data URL.
- The `mode` tag (`"dark" | "light" | "both"`) is chosen at import time; importing the
  same file twice for dark and for light creates two entries (each with its own id and
  blob) or, if we prefer to save space, one blob whose id is referenced by both slots —
  either is acceptable. Re-tagging an imported image later (e.g. dark → both) updates
  its metadata without re-encoding.
- On import, **downscale and compress in a canvas** before storing: longest edge
  ~1920 px, encode WebP (or JPEG), target ≤ ~500 KB. Reject files over a hard cap
  (e.g. 10 MB) with a readable error.
- On remove, delete the IndexedDB entry and its `customBackgrounds` metadata (and
  clear either background slot pointing at it).
- On startup, custom ids whose IndexedDB entry is missing degrade to `"none"` rather
  than a broken image.

## Rendering

In `renderBreak` (`views.ts`), resolve the active background from the current
`settings.themeMode` — `restBackgroundDark` in dark mode, `restBackgroundLight` in
light mode — and when active render a full-bleed, non-interactive layer **behind**
`.session-main`:

- `<div class="rest-bg" aria-hidden="true">` with two stacked layers: the image
  (`background-image`, `background-size: cover`, centered) and a scrim using the
  active theme's `--bg` at `restBackgroundDim` opacity.
- Blur via `filter: blur(<n>px)` on the image layer plus `transform: scale(1.06)` so
  blurred edges don't show.
- The scrim must guarantee the clock and buttons stay legible. Default `dim: 45` should
  meet **WCAG AA (4.5:1)** for `.clock` and `.session-task-title` against the active
  theme's text color; if the user drags dim to 0, still apply a thin baseline scrim so
  text never disappears, and show a contrast hint in settings.
- Only render on the break screen — never in focus, quick-run, or board views.
- Preload/decode the active mode's image when the break starts (or when selected in
  settings) and keep the current solid background until it's ready, so there is no
  flash; warm the other mode's image too so a day/night toggle mid-break doesn't blink.
- Do not add motion by default; if a gentle Ken Burns pan is added, disable it under
  `prefers-reduced-motion: reduce`.

CSS lives in `style.css` next to the session rules; use theme tokens (not hard-coded
colors) so all 0085 themes work. Add a `--rest-bg-scrim` token if a per-theme value is
useful.

## Settings UI

Add a **"Rest background"** section to the existing **Appearance** tab
(`actions.ts` settings dialog), consistent with 0050/0076/0085:

- Two labeled thumbnail pickers — **"Night background"** (used in dark mode) and
  **"Day background"** (used in light mode) — each a grid of built-in images plus a
  "None" tile; selecting applies immediately.
- Custom images appear in the picker(s) matching their `mode` tag, with a small
  **Night / Day / Both** badge. A "Same for day and night" shortcut copies one slot's
  selection into the other.
- **Load image…** (hidden `accept="image/*"` input) with a **mode selector** (Night /
  Day / Both, default Both) applied to the import; a custom image's tag can be changed
  afterwards from the picker, which updates both slots as needed.
- **Remove image** (custom only), which also clears any slot referencing it.
- **Dim** and **Blur** range sliders with live labels and instant preview.
- A **Photo credits** line/section for the selected built-in.
- All controls keyboard accessible with labels; the settings panel's current
  no-Save-required behavior for appearance controls applies.

## Service worker / offline

- Add the bundled background files to the `public/sw.js` precache list and bump the
  cache version (`v2`), so images are available offline (0049). Keep the precache
  budget in mind — this is the main reason to cap image count and size.
- Built-in images use the normal HTTP cache; custom images live in IndexedDB and need
  no network.

### Implementation map

- `src/backgrounds.ts` — built-in catalog + id resolution/labels; `src/backgroundStore.ts`
  — IndexedDB cache, downscale/compress on import, prune.
- `src/types.ts` / `src/storage.ts` — settings fields, defaults, sanitize/migrate.
- `src/views.ts` — `restBackgroundHtml()` layer in `renderBreak`.
- `src/actions.ts` — Appearance-tab pickers, preview, import/remove handlers.
- `src/style.css` — `.rest-bg*`, `.bg-picker`/`.bg-tile`/`.bg-preview` styles.
- `src/main.ts` — hydrate custom images at startup and on cross-tab settings changes.

## Behavior

- Enabling a background shows it only on the break screen; focus sessions are
  unaffected.
- Switching **day/night** (the 0085 theme toggle) swaps to the matching slot live, even
  mid-break; if the other slot is `"none"`, that mode simply shows the plain rest
  screen.
- Changing background, dim, or blur applies instantly and persists across reload.
- A custom image survives reload, keeps its Night/Day/Both tag, is removed cleanly, and
  never corrupts settings if its bytes are missing.
- Background changes sync across tabs via the existing cross-tab sync (0056).
- With no background selected in a mode, the rest screen renders exactly as today.

## Acceptance criteria

- The Appearance tab offers separate **Night** and **Day** background pickers with the
  bundled nature images, plus "None" and a "Load image…" action.
- Selecting a background shows it on the rest/break screen behind the clock; the clock
  and controls remain legible at every dim setting.
- A custom image tagged **Night** shows only in dark mode and one tagged **Day** shows
  only in light mode; toggling day/night swaps between them, and an untagged/`"both"`
  image is used in either.
- Built-in backgrounds work offline after first load (service-worker cached).
- A user-loaded image is downscaled, persists (with its mode tag) across reload, and can
  be removed; an oversized/invalid file is rejected with a clear message.
- The background never appears outside rest mode, is `aria-hidden`, and respects
  `prefers-reduced-motion`.
- Default install is visually unchanged (no background until enabled).
- `sanitizeSettings` handles missing/invalid new fields without data loss; export/
  import and backups round-trip the new settings.
- Page weight stays reasonable: total bundled backgrounds within the agreed budget.

## Nice to have

- **Randomize each break** from a set of favorites (or "surprise me").
- A very slow **Ken Burns / drift** animation, gated behind reduced-motion.
- **Per-theme default** background (Tide → coast, Forest → forest stream) picked
  automatically until the user overrides it.
- **Auto-suggest a mode** for a loaded image by sampling its average luminance, and
  offer to tag it rather than making the user choose.
- A single file dropped once that **generates matching day and night treatments**
  (brightened/darkened variants) so users need one photo, not two.
- An opt-in **focus-mode ambient background** with a much stronger scrim.
- **Include custom backgrounds in export/backups** (base64 or a zip), with a size guard.
- Crossfade between images when the background changes.
- A "shuffle" button and drag-to-reorder of favorites.
- Reuse the rest-guide's "Nature" tip (0078) to link straight into this setting.
