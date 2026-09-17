import { isFontId, fontById } from "./fonts";
import { THEME_TOKENS } from "./types";
import type { Theme, ThemeColors, ThemeMode, ThemeToken } from "./types";
import forestJson from "./themes/forest.json";
import tideJson from "./themes/tide.json";
import clayJson from "./themes/clay.json";
import duskJson from "./themes/dusk.json";
import slateJson from "./themes/slate.json";
import highContrastJson from "./themes/high-contrast.json";

export const THEME_APP = "ultradiandrift-theme";
export const THEME_VERSION = 1;
export const DEFAULT_THEME_ID = "forest";

const HEX = "#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})";
const FUNC = "(?:rgba?|hsla?)\\([0-9.,%\\s]+\\)";
const COLOR = `(?:${HEX}|${FUNC}|transparent|currentColor)`;
const COLOR_RE = new RegExp(`^${COLOR}$`);
const SHADOW_RE = new RegExp(
  `^(?:none|-?\\d*\\.?\\d+(?:px|rem|em|%)?\\s+-?\\d*\\.?\\d+(?:px|rem|em|%)?\\s+-?\\d*\\.?\\d+(?:px|rem|em|%)?(?:\\s+-?\\d*\\.?\\d+(?:px|rem|em|%)?)?\\s+${COLOR})$`,
);

/** The trusted default. Its tokens mirror the base `:root` / `[data-theme="day"]` CSS. */
const FOREST = forestJson as unknown as Theme;

export const BUILTIN_THEMES: Theme[] = [
  FOREST,
  ...[tideJson, clayJson, duskJson, slateJson, highContrastJson]
    .map((raw) => sanitizeTheme(raw))
    .filter((t): t is Theme => t !== null),
];

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isValidToken(token: ThemeToken, value: string): boolean {
  const v = value.trim();
  if (token === "shadow") return SHADOW_RE.test(v);
  return COLOR_RE.test(v);
}

function sanitizeColors(raw: unknown, base: ThemeColors): ThemeColors {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const token of THEME_TOKENS) {
    const v = r[token];
    if (typeof v === "string" && isValidToken(token, v)) out[token] = v.trim();
  }
  return out;
}

/** Validate and repair an arbitrary theme object; returns null if it isn't usable. */
export function sanitizeTheme(raw: unknown): Theme | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
  if (!name) return null;
  const slug = slugify(typeof r.id === "string" && r.id.trim() ? r.id : name);
  return {
    id: slug || "theme",
    name,
    defaultMode: r.defaultMode === "light" ? "light" : "dark",
    font: isFontId(r.font) ? r.font : undefined,
    dark: sanitizeColors(r.dark, FOREST.dark),
    light: sanitizeColors(r.light, FOREST.light),
  };
}

export function allThemes(custom: Theme[]): Theme[] {
  return [...BUILTIN_THEMES, ...custom];
}

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some((t) => t.id === id);
}

export function findTheme(id: string, custom: Theme[]): Theme {
  return allThemes(custom).find((t) => t.id === id) ?? FOREST;
}

/** A theme id derived from `name`, de-duplicated against built-ins and existing customs. */
export function uniqueThemeId(name: string, custom: Theme[]): string {
  const base = slugify(name) || "theme";
  const taken = new Set(allThemes(custom).map((t) => t.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export type ThemeParseResult = { ok: true; theme: Theme } | { ok: false; error: string };

/** Parse a theme file's JSON text, validating shape and every color token. */
export function parseThemeFile(text: string): ThemeParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (typeof obj !== "object" || obj === null) {
    return { ok: false, error: "This file is not an UltradianDrift theme." };
  }
  const r = obj as Record<string, unknown>;
  if (r.app !== THEME_APP) {
    return { ok: false, error: "This file is not an UltradianDrift theme." };
  }
  if (r.version !== THEME_VERSION) {
    return { ok: false, error: `Unsupported theme version (${String(r.version)}).` };
  }
  if (typeof r.name !== "string" || !r.name.trim()) {
    return { ok: false, error: "This theme has no name." };
  }
  const theme = sanitizeTheme(r);
  if (!theme) return { ok: false, error: "This theme couldn't be read." };
  return { ok: true, theme };
}

/** Serialize a theme in the importable/exportable file shape. */
export function themeToJson(theme: Theme): string {
  return JSON.stringify(
    {
      app: THEME_APP,
      version: THEME_VERSION,
      id: theme.id,
      name: theme.name,
      defaultMode: theme.defaultMode,
      ...(theme.font ? { font: theme.font } : {}),
      dark: theme.dark,
      light: theme.light,
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* Applying a theme to the document                                    */
/* ------------------------------------------------------------------ */

const STYLE_ID = "theme-vars";

function declarations(colors: ThemeColors): string {
  return THEME_TOKENS.map((t) => `--${t}:${colors[t]};`).join("");
}

/**
 * The Forest theme is the CSS base, so it injects nothing (no-JS/first paint stays
 * unchanged). Every other theme gets a single `<style>` with validated values.
 */
function applyThemeStyle(theme: Theme): void {
  const existing = document.getElementById(STYLE_ID);
  if (theme.id === DEFAULT_THEME_ID) {
    existing?.remove();
    return;
  }
  const css = `:root{${declarations(theme.dark)}}:root[data-theme="day"]{${declarations(theme.light)}}`;
  if (existing) {
    existing.textContent = css;
  } else {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
}

function updateThemeColorMeta(theme: Theme, mode: ThemeMode): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = mode === "light" ? theme.light.bg : theme.dark.bg;
}

/** Apply the active theme, mode, and font to the document. */
export function applyAppearance(theme: Theme, mode: ThemeMode, fontId: string): void {
  const root = document.documentElement;
  root.dataset.theme = mode === "light" ? "day" : "night";
  root.dataset.font = fontId;
  root.style.colorScheme = mode;
  const font = fontById(fontId);
  root.style.setProperty("--font-body", font.body);
  root.style.setProperty("--font-display", font.display);
  applyThemeStyle(theme);
  updateThemeColorMeta(theme, mode);
}
