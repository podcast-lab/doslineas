export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function toRgb(color: string): Rgb {
  const hex = color.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${color} is not a #rrggbb colour`);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = toRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function relativeLuminance(color: string): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = toRgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(one: string, other: string): number {
  const a = relativeLuminance(one);
  const b = relativeLuminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableOn(background: string, candidates: readonly string[]): string {
  const best = [...candidates].sort((a, b) => contrastRatio(background, b) - contrastRatio(background, a)).at(0);
  if (best !== undefined) return best;
  return relativeLuminance(background) > 0.4 ? "#000000" : "#ffffff";
}

export interface FontFace {
  readonly family: string;
  readonly dataUrl: string | null;
  readonly weight: number;
}

const FALLBACK_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function fontStack(font: FontFace): string {
  return `'${font.family}', ${FALLBACK_STACK}`;
}

export function fontFaceCss(fonts: readonly FontFace[]): string {
  return fonts
    .filter((font) => font.dataUrl !== null)
    .map(
      (font) =>
        `@font-face { font-family: '${font.family}'; font-weight: ${font.weight}; font-display: block; src: url(${font.dataUrl ?? ""}); }`
    )
    .join("\n");
}
