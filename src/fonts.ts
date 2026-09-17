/**
 * 0085: UI font pairings. Each option names a body stack and a display stack;
 * `applyAppearance` writes them to the `--font-body` / `--font-display`
 * custom properties. Bundled families are self-hosted in `public/fonts`
 * (see the `@font-face` rules in `style.css`); the rest are system stacks.
 */

export interface FontOption {
  id: string;
  label: string;
  body: string;
  display: string;
}

export const FONTS: FontOption[] = [
  {
    id: "rounded",
    label: "Rounded — Nunito Sans + Fraunces",
    body: '"Nunito Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    display: '"Fraunces", Georgia, "Times New Roman", serif',
  },
  {
    id: "system",
    label: "System — neutral sans + serif",
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    display: 'Georgia, Cambria, "Times New Roman", serif',
  },
  {
    id: "mono",
    label: "Monospace",
    body: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    display: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
  {
    id: "hyperlegible",
    label: "High legibility — Atkinson Hyperlegible + Fraunces",
    body: '"Atkinson Hyperlegible", "Nunito Sans", system-ui, sans-serif',
    display: '"Fraunces", Georgia, "Times New Roman", serif',
  },
  {
    id: "reading",
    label: "Reading — Lexend",
    body: '"Lexend", "Nunito Sans", system-ui, sans-serif',
    display: '"Lexend", "Nunito Sans", system-ui, sans-serif',
  },
];

export const DEFAULT_FONT_ID = "rounded";

export function fontById(id: string): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function isFontId(id: unknown): id is string {
  return typeof id === "string" && FONTS.some((f) => f.id === id);
}
