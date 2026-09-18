/**
 * 0086: catalog of built-in rest backgrounds plus resolution helpers.
 *
 * Built-ins are tiny, self-contained SVG nature scenes that carry no license or
 * network requirement; users can load their own images separately (see
 * `backgroundStore.ts`). A background id is either `"none"`, a built-in id, or a
 * `custom:<uuid>` reference.
 */

import { newId } from "./types";
import type { BackgroundImage, BackgroundMode } from "./types";
import { cachedBackground } from "./backgroundStore";

export const NO_BACKGROUND = "none";
export const CUSTOM_BACKGROUND_PREFIX = "custom:";

export interface BuiltinBackground {
  id: string;
  label: string;
  src: string;
  credit: string;
  suggestedMode: BackgroundMode;
}

export const BUILTIN_BACKGROUNDS: BuiltinBackground[] = [
  {
    id: "forest-stream",
    label: "Forest stream",
    src: "backgrounds/forest-stream.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "dark",
  },
  {
    id: "misty-pines",
    label: "Misty pines",
    src: "backgrounds/misty-pines.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "dark",
  },
  {
    id: "ocean-waves",
    label: "Ocean waves",
    src: "backgrounds/ocean-waves.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "both",
  },
  {
    id: "mountain-lake",
    label: "Mountain lake",
    src: "backgrounds/mountain-lake.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "both",
  },
  {
    id: "meadow",
    label: "Summer meadow",
    src: "backgrounds/meadow.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "light",
  },
  {
    id: "rain-leaves",
    label: "Rain on leaves",
    src: "backgrounds/rain-leaves.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "dark",
  },
  {
    id: "desert-dunes",
    label: "Desert dunes",
    src: "backgrounds/desert-dunes.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "light",
  },
  {
    id: "night-sky",
    label: "Starry night",
    src: "backgrounds/night-sky.svg",
    credit: "UltradianDrift illustration",
    suggestedMode: "dark",
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_BACKGROUNDS.map((b) => [b.id, b]));

export function isBuiltinBackground(id: string): boolean {
  return BUILTIN_BY_ID.has(id);
}

export function isCustomBackgroundId(id: string): boolean {
  return id.startsWith(CUSTOM_BACKGROUND_PREFIX);
}

/** The storage key for a `custom:<uuid>` id. */
export function customBackgroundKey(id: string): string {
  return id.slice(CUSTOM_BACKGROUND_PREFIX.length);
}

/** A fresh `custom:<uuid>` id. */
export function newCustomBackgroundId(): string {
  return `${CUSTOM_BACKGROUND_PREFIX}${newId()}`;
}

/** The image URL for a background id, or null when it isn't available yet. */
export function backgroundSrc(id: string): string | null {
  if (id === NO_BACKGROUND) return null;
  const builtin = BUILTIN_BY_ID.get(id);
  if (builtin) return builtin.src;
  if (isCustomBackgroundId(id)) return cachedBackground(customBackgroundKey(id)) ?? null;
  return null;
}

export function builtinBackground(id: string): BuiltinBackground | undefined {
  return BUILTIN_BY_ID.get(id);
}

export function customBackground(
  id: string,
  custom: BackgroundImage[],
): BackgroundImage | undefined {
  return custom.find((b) => b.id === id);
}

/** Whether a background id (of any kind) is valid against the known customs. */
export function isValidBackgroundId(id: string, custom: BackgroundImage[]): boolean {
  if (id === NO_BACKGROUND) return true;
  if (isBuiltinBackground(id)) return true;
  return isCustomBackgroundId(id) && custom.some((b) => b.id === id);
}

/** The label shown for any background id. */
export function backgroundLabel(id: string, custom: BackgroundImage[]): string {
  if (id === NO_BACKGROUND) return "None";
  return builtinBackground(id)?.label ?? customBackground(id, custom)?.name ?? "Image";
}

/**
 * Backgrounds offered in a day/night picker: every built-in (the user may place any
 * in either slot) plus custom images tagged for that mode or "both".
 */
export function backgroundsForMode(
  mode: "dark" | "light",
  custom: BackgroundImage[],
): Array<{ id: string; label: string; src: string | null; mode: BackgroundMode }> {
  const builtins = BUILTIN_BACKGROUNDS.map((b) => ({
    id: b.id,
    label: b.label,
    src: b.src,
    mode: b.suggestedMode,
  }));
  const customs = custom
    .filter((b) => b.mode === "both" || b.mode === mode)
    .map((b) => ({
      id: b.id,
      label: b.name,
      src: backgroundSrc(b.id),
      mode: b.mode,
    }));
  return [...builtins, ...customs];
}
