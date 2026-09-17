// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  applyAppearance,
  findTheme,
  parseThemeFile,
  sanitizeTheme,
  themeToJson,
} from "./theme";

const VALID_THEME = {
  app: "ultradiandrift-theme",
  version: 1,
  id: "ocean-test",
  name: "Ocean Test",
  defaultMode: "dark",
  dark: {
    bg: "#001122",
    text: "#ffffff",
    accent: "#00aaff",
    shadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
  },
  light: { bg: "#ffffff" },
};

beforeEach(() => {
  document.getElementById("theme-vars")?.remove();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.font;
});

describe("built-in themes", () => {
  it("ships the six examples with unique ids and Forest first", () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(6);
    expect(BUILTIN_THEMES[0].id).toBe(DEFAULT_THEME_ID);
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseThemeFile", () => {
  it("accepts a valid theme and fills missing tokens from Forest", () => {
    const result = parseThemeFile(JSON.stringify(VALID_THEME));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe("ocean-test");
    expect(result.theme.dark.bg).toBe("#001122");
    expect(result.theme.dark.accent).toBe("#00aaff");
    // Tokens that weren't provided fall back to Forest.
    expect(result.theme.dark.moss).toBe(findTheme(DEFAULT_THEME_ID, []).dark.moss);
    expect(result.theme.light.bg).toBe("#ffffff");
    expect(result.theme.light.text).toBe(findTheme(DEFAULT_THEME_ID, []).light.text);
  });

  it("rejects invalid JSON and foreign files", () => {
    expect(parseThemeFile("not json").ok).toBe(false);
    expect(parseThemeFile("[]").ok).toBe(false);
    expect(parseThemeFile(JSON.stringify({ app: "something-else" })).ok).toBe(false);
    expect(
      parseThemeFile(JSON.stringify({ ...VALID_THEME, version: 99 })).ok,
    ).toBe(false);
    expect(parseThemeFile(JSON.stringify({ ...VALID_THEME, name: "  " })).ok).toBe(false);
  });

  it("ignores unsafe color values instead of injecting them", () => {
    const evil = {
      ...VALID_THEME,
      dark: { ...VALID_THEME.dark, bg: "red; } body { display: none } .x {" },
    };
    const result = parseThemeFile(JSON.stringify(evil));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.dark.bg).toBe(findTheme(DEFAULT_THEME_ID, []).dark.bg);
  });

  it("round-trips through themeToJson", () => {
    const tide = findTheme("tide", []);
    const result = parseThemeFile(themeToJson(tide));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.dark).toEqual(tide.dark);
    expect(result.theme.light).toEqual(tide.light);
    expect(result.theme.name).toBe(tide.name);
  });
});

describe("sanitizeTheme", () => {
  it("returns null for non-objects and nameless themes", () => {
    expect(sanitizeTheme(null)).toBeNull();
    expect(sanitizeTheme("nope")).toBeNull();
    expect(sanitizeTheme({})).toBeNull();
  });
});

describe("applyAppearance", () => {
  it("sets the mode, font, and injects variables for non-Forest themes", () => {
    applyAppearance(findTheme("tide", []), "light", "system");
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(document.documentElement.dataset.font).toBe("system");
    const style = document.getElementById("theme-vars");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("--bg:");
    expect(style!.textContent).toContain(":root[data-theme=\"day\"]");
  });

  it("injects nothing for Forest and removes stale variables", () => {
    applyAppearance(findTheme("tide", []), "dark", "rounded");
    expect(document.getElementById("theme-vars")).not.toBeNull();
    applyAppearance(findTheme(DEFAULT_THEME_ID, []), "dark", "rounded");
    expect(document.getElementById("theme-vars")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("night");
  });
});
