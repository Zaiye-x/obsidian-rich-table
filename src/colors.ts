export type FavoriteColorKind = "text" | "background";

export interface FavoriteColors {
  text: string[];
  background: string[];
}

export interface FavoriteColorController {
  get(): FavoriteColors;
  add(kind: FavoriteColorKind, color: string): void;
  remove(kind: FavoriteColorKind, color: string): void;
}

export const FAVORITE_COLOR_LIMIT = 12;

const DEFAULT_TEXT_COLOR = "#ffffff";
const DEFAULT_BACKGROUND_COLOR = "#2483ff";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function normalized(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

function readList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const colors: string[] = [];
  for (const item of value) {
    const color = normalized(item);
    if (color && !colors.includes(color)) colors.push(color);
    if (colors.length === FAVORITE_COLOR_LIMIT) break;
  }
  return colors;
}

export function defaultFavoriteColors(): FavoriteColors {
  return { text: [DEFAULT_TEXT_COLOR], background: [DEFAULT_BACKGROUND_COLOR] };
}

export function readFavoriteColors(value: unknown): FavoriteColors {
  const saved = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaults = defaultFavoriteColors();
  return {
    text: readList(saved.text, defaults.text),
    background: readList(saved.background, defaults.background)
  };
}

export function addFavoriteColor(colors: FavoriteColors, kind: FavoriteColorKind, value: string): FavoriteColors {
  const color = normalized(value), current = colors[kind];
  if (!color || current.includes(color) || current.length >= FAVORITE_COLOR_LIMIT) return colors;
  return { ...colors, [kind]: [...current, color] };
}

export function removeFavoriteColor(colors: FavoriteColors, kind: FavoriteColorKind, value: string): FavoriteColors {
  const color = normalized(value);
  if (!color || !colors[kind].includes(color)) return colors;
  return { ...colors, [kind]: colors[kind].filter(item => item !== color) };
}
