# 0085 — Themes, theme files, and UI fonts

Status: done

## Goal

UltradianDrift ships a single hard-coded appearance: the "Forest" palette in
`style.css` (night under `:root`, day under `:root[data-theme="day"]`), a corner
day/night toggle, and one self-hosted type pairing (Nunito Sans body, Fraunces
display). Give people control over how the app looks and feels:

- Pick from several **built-in themes** (distinct palettes, each with a dark and a
  light variant).
- **Load a theme from a file** so themes can be shared and kept outside the app.
- Choose the **UI font pairing** independently of the palette.
- Ship a small set of **example themes** as built-ins so the feature is useful out
  of the box.

## Model

### Theme data

A theme is JSON — the same shape users import and export:

```json
{
  "app": "ultradiandrift-theme",
  "version": 1,
  "id": "tide",
  "name": "Tide",
  "defaultMode": "dark",
  "font": "system",
  "dark": { "bg-glow": "#16303a", "bg": "#0b1a22", "text": "#e2eef2", "...": "..." },
  "light": { "bg-glow": "#d7e8ee", "bg": "#eef4f6", "text": "#1e2f36", "...": "..." }
}
```

- `dark`/`light` each carry the **color tokens only** (the CSS custom properties
  without the `--` prefix): `bg-glow, bg, bg-soft, surface, surface-2, border,
  text, text-dim, text-faint, accent, accent-hover, accent-bright, on-accent,
  moss, leaf, earth, clay, gold, danger, shadow, overlay`. Structural tokens
  (`--radius*`, `--text-*`, fonts) are not part of a theme.
- `font` is an **optional suggestion**: selecting the theme applies it, but the
  user can override it afterwards with the font picker.
- `id` is required for built-ins; for imported themes it may be omitted and is
  derived from a slug of `name`, de-duplicated with a numeric suffix.

### Built-in examples (`src/themes/*.json`)

Bundle one JSON file per theme and import them (Vite supports JSON imports):

- `forest.json` — the current greens; **the default**. Its tokens must match
  today's `:root` / `[data-theme="day"]` values exactly so the default look is
  unchanged.
- `tide.json` — cool ocean blues/teals.
- `clay.json` — warm desert ochre/terracotta.
- `dusk.json` — muted plum/berry.
- `slate.json` — low-stimulation near-monochrome with a soft sage accent.
- `high-contrast.json` — accessibility theme (pure black/white, bright accent).

### Fonts

Refactor `style.css` so the body font and display font are variables:
`--font-body` and `--font-display` on `:root`, with the `h1` / `.page-title` /
`.session-task-title` rule using `var(--font-display)`. A font catalog in
`src/fonts.ts` maps an id → `{ label, body, display }`:

- `rounded` — `"Nunito Sans"` + `"Fraunces"` (default; already bundled).
- `system` — `system-ui, …` + `Georgia, …` (no download).
- `mono` — `ui-monospace, …` for both (no download).
- `hyperlegible` — `"Atkinson Hyperlegible"` + `"Fraunces"` (new, self-hosted).
- `reading` — `"Lexend"` + `"Lexend"` (new, self-hosted).

Self-host the two new fonts the same way as 0065: WOFF2, latin + latin-ext
subsets under `public/fonts/`, `@font-face` with `font-display: swap` and a
`unicode-range`, added to the `public/sw.js` precache list. Keep the page-weight
budget reasonable (subset aggressively; prefer one weight axis).

### Settings

- Replace `theme: "night" | "day"` with:
  - `themeId: string` — the active theme (`"forest"` by default).
  - `themeMode: "dark" | "light"` — the active variant (defaults to the theme's
    `defaultMode`).
  - `font: string` — the active font id (`"rounded"` by default).
  - `customThemes: Theme[]` — imported themes, persisted with settings so they
    survive reload and travel in Export/backup. Cap at ~20 entries.
- `sanitizeSettings` (`storage.ts`) must migrate the old `theme` key: `"day"` →
  `{ themeId: "forest", themeMode: "light" }`, `"night"` (or missing) → dark.
  Validate `themeId` / `font` against known ids (unknown → default), and validate
  every token of each `customThemes` entry.

### Applying a theme

- `applyTheme(mode)` keeps setting `data-theme` (`"day"` for light, absent/`"night"`
  for dark) so structural CSS is untouched, and additionally updates
  `document.documentElement.style.colorScheme` and the `<meta name="theme-color">`
  to the active theme's `--bg`.
- For a **custom** (non-Forest) theme, inject a single `<style id="theme-vars">`
  appended after the main stylesheet containing the dark tokens under `:root` and
  the light tokens under `:root[data-theme="day"]` (built only from validated
  values). Remove that element when Forest is active. Rebuild it on theme change.
- The corner day/night toggle keeps its role: it flips `themeMode` between the
  selected theme's dark and light variants, then re-renders.
- The Forest built-in should use the existing `:root` rules and inject nothing, so
  first paint and the no-JS default are unchanged.

### Loading a theme from a file

- A **"Load theme file…"** action in Settings opens a hidden file input
  (`accept="application/json,.json"`), reads it with `FileReader`, and validates:
  - `app === "ultradiandrift-theme"` and a supported `version`.
  - `name` is a non-empty string, trimmed to ≤ 40 chars.
  - Every color token is a string matching a **strict allow-list** — `#rgb`,
    `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, or a plain
    `transparent`/named-safe value — capped in length. Unknown keys are ignored;
    missing tokens fall back to Forest so a partial theme still works.
  - Never interpolate arbitrary CSS: only the known token list is written into the
    `<style>`, and only after validation. This prevents CSS injection.
- On success, add/replace it in `customThemes`, select it, `saveSettings`, and
  re-render; on failure, reuse the existing `showImportError`-style dialog with a
  clear reason.
- **"Export theme"** writes the active theme (built-in or custom) as a
  `*.theme.json` download using the same shape, so round-tripping works.
- **"Remove theme"** appears only for custom themes (a built-in can't be removed).

### Settings UI

Add an **Appearance** block (a third Settings tab, "Appearance", or a section in
Basic — a tab keeps 0076's layout intent):

- Theme picker: a swatch grid / `<select>` of built-in + custom themes, each
  showing a name and a few color chips; selecting one applies it immediately.
- Mode: a day/night segmented control (mirrors the corner toggle).
- Font: a `<select>` of the catalog with a live preview line.
- Actions: Load theme file… · Export theme · Remove theme.
- All controls keyboard-accessible with labels, consistent with 0050.

## Behavior

- Changing theme, mode, or font applies instantly (no Save required) and persists.
- The selected theme survives reload; custom themes are restored from settings.
- A custom theme's `defaultMode` decides whether dark or light shows first; the
  corner toggle still switches afterwards.
- Importing a theme with the same `id`/name replaces the existing custom entry.
- The default install looks exactly like Forest today.
- Fonts that fail to load fall back to the system stack (no FOIT).

## Acceptance criteria

- Settings offers at least the six built-in themes and applies each instantly.
- The corner toggle switches dark/light for whichever theme is active.
- A theme exported from the app can be imported back, unchanged.
- A theme file from disk loads (custom themes persist across reload) and an
  invalid/malicious file is rejected safely with a readable message.
- The font picker changes body + display fonts live, and the choice persists.
- The default (Forest) rendering is byte-for-byte identical to today's palette.
- Works offline: bundled fonts are cached by the service worker; no network needed
  to switch themes or fonts.
- `sanitizeSettings` migrates the legacy `theme` value without data loss; export/
  import and backups round-trip the new fields.

## Nice to have

- Follow the OS `prefers-color-scheme` on first run to pick the initial mode.
- Per-theme `--radius` / density tokens, or a "reduce motion" theme flag.
- A "Randomize accent" generator, and a live contrast readout (WCAG AA) that warns
  when text/accent pairs fall below 4.5:1.
- Theme preview thumbnails rendered from each theme's chips in the picker.
- Sync appearance via the existing cross-tab sync (0056) so a theme change in one
  tab updates the others.
