// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  BUILTIN_BACKGROUNDS,
  NO_BACKGROUND,
  backgroundSrc,
  backgroundsForMode,
  customBackgroundKey,
  isBuiltinBackground,
  isCustomBackgroundId,
  isValidBackgroundId,
  newCustomBackgroundId,
} from "./backgrounds";
import { saveBackground } from "./backgroundStore";
import type { BackgroundImage } from "./types";

const CUSTOM: BackgroundImage[] = [
  { id: "custom:night", name: "Night ridge", addedAt: 1, mode: "dark" },
  { id: "custom:day", name: "Day coast", addedAt: 2, mode: "light" },
  { id: "custom:any", name: "Any sky", addedAt: 3, mode: "both" },
];

describe("built-in backgrounds", () => {
  it("ships unique ids with a suggested mode and an asset path", () => {
    const ids = BUILTIN_BACKGROUNDS.map((b) => b.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BUILTIN_BACKGROUNDS) {
      expect(b.src).toMatch(/^backgrounds\/.+\.svg$/);
      expect(b.credit).toBeTruthy();
    }
  });

  it("resolves built-ins to their asset path", () => {
    expect(backgroundSrc("ocean-waves")).toBe("backgrounds/ocean-waves.svg");
    expect(backgroundSrc(NO_BACKGROUND)).toBeNull();
    expect(backgroundSrc("nope")).toBeNull();
    expect(isBuiltinBackground("meadow")).toBe(true);
    expect(isBuiltinBackground("nope")).toBe(false);
  });
});

describe("custom background ids", () => {
  it("round-trips a custom id through its storage key", () => {
    const id = newCustomBackgroundId();
    expect(isCustomBackgroundId(id)).toBe(true);
    expect(customBackgroundKey(id)).toBe(id.slice("custom:".length));
  });

  it("resolves a cached custom image and drops unknown ids", async () => {
    await saveBackground("night", "data:image/png;base64,AAAA");
    expect(backgroundSrc("custom:night")).toBe("data:image/png;base64,AAAA");
    expect(backgroundSrc("custom:missing")).toBeNull();
  });

  it("validates ids against the known customs", () => {
    expect(isValidBackgroundId(NO_BACKGROUND, CUSTOM)).toBe(true);
    expect(isValidBackgroundId("forest-stream", CUSTOM)).toBe(true);
    expect(isValidBackgroundId("custom:day", CUSTOM)).toBe(true);
    expect(isValidBackgroundId("custom:missing", CUSTOM)).toBe(false);
    expect(isValidBackgroundId("nope", CUSTOM)).toBe(false);
  });
});

describe("backgroundsForMode", () => {
  it("offers every built-in plus customs tagged for the mode", () => {
    const dark = backgroundsForMode("dark", CUSTOM).map((b) => b.id);
    expect(dark).toContain("forest-stream");
    expect(dark).toContain("custom:night");
    expect(dark).toContain("custom:any");
    expect(dark).not.toContain("custom:day");

    const light = backgroundsForMode("light", CUSTOM).map((b) => b.id);
    expect(light).toContain("custom:day");
    expect(light).toContain("custom:any");
    expect(light).not.toContain("custom:night");
  });
});
