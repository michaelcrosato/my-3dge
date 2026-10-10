/**
 * @file Colours as data (PLAN.md §6.3): hex strings in data, linear floats for shaders and instance colours, sRGB on
 * output. `hex`, `toHex`, `toHsl`, `hsl`, `shade`, `mix`, `tones` and `ramp` are my-3d2dge's helpers, bit-exact:
 * hue-shifted shading as pixel artists paint it (shadows drift cool, highlights warm). `toLinear` and `fromLinear`
 * go through three.js's `Color`, so a colour converted here matches the same hex given to a material.
 *
 * Invariants: bytes are 0–255 and may be fractional on the way in (`toHex` rounds and clamps); hues are degrees,
 * saturation and lightness 0–1. Accepted hex forms: `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, with or without
 * `#`, alpha ignored; anything else throws `CORE_BAD_COLOR` (my-3d2dge drew it magenta). `tones` returns the input
 * string as `base`. Results depend only on the inputs; the linear conversions assume three.js's colour management
 * is on (its default).
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:97` (`hex`, `toHex`, `shade`, `mix`) and
 * `my-3d2dge:engine/my-3d2dge.js:144` (`toHsl`, `hsl`, `tones`, `ramp`), without their caches (results unchanged).
 *
 * @example
 * hex('#3b2a2f'); // [59, 42, 47]
 * shade('#336699', -0.3); // darker and cooler
 * tones('#f1c7a0').deep; // '#bd4a3b'
 * toLinear('#808080'); // [0.2158605…, 0.2158605…, 0.2158605…]
 * @see engine/core/color.test.ts
 */
import { Color } from './math';

/** One code's text: the message (`{name}` marks a value), what to do, and more detail for docs/ERRORS.md. */
interface CodeText {
  template: string;
  fix: string;
  doc?: string;
}

/** Stand-in for engine/core/log.ts's `defineCodes` (WP 1.2 replaces it): returns the table as given, typed. */
function defineCodes<const T extends Record<string, CodeText>>(_area: string, codes: T): T {
  return codes;
}

/** The codes this module raises, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const COLOR_CODES = defineCodes('core', {
  CORE_BAD_COLOR: {
    template: 'color {color} is not a hex color',
    fix: "write colours as hex strings: '#rrggbb' (or '#rgb', '#rgba', '#rrggbbaa')",
    doc: 'Raised by the colour helpers (engine/core/color.ts) for a string that is not hex. Colours are hex strings in data (PLAN.md §6.3); names such as `red` and `rgb()` forms are not accepted, so a typo fails where it is read instead of drawing the wrong colour.',
  },
});

/** A colour as three bytes, 0–255 (fractions allowed): red, green, blue. */
export type Rgb = [number, number, number];

/** A colour as given to the helpers: a hex string, or bytes. */
export type ColorInput = string | readonly number[];

/** The five shades of `tones`: deep shadow, shadow, the base itself, light and highlight. */
export interface Tones {
  deep: string;
  sh: string;
  base: string;
  lt: string;
  hi: string;
}

const HEX = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A hex colour (or bytes, of which the first three are kept) as bytes. */
export function hex(color: ColorInput): Rgb {
  if (typeof color !== 'string') return [color[0], color[1], color[2]];
  let s = color.trim();
  if (s[0] === '#') s = s.slice(1);
  if (!HEX.test(s)) {
    const { template, fix } = COLOR_CODES.CORE_BAD_COLOR;
    throw new TypeError(`[CORE_BAD_COLOR] ${template.replace('{color}', JSON.stringify(color))}: ${fix}`);
  }
  if (s.length <= 4) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Bytes as `#rrggbb`, each rounded and clamped to 0–255. */
export function toHex(rgb: readonly number[]): string {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** A colour as `[hue in degrees 0–360, saturation 0–1, lightness 0–1]`. */
export function toHsl(color: ColorInput): [number, number, number] {
  const [r, g, b] = hex(color).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/** Hue (degrees, any value), saturation and lightness (clamped to 0–1) as `#rrggbb`. */
export function hsl(h: number, s: number, l: number): string {
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** `h` turned toward the hue `target` by at most `amount` degrees, the short way round. */
function hueToward(h: number, target: number, amount: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + clamp(d, -amount, amount);
}

/**
 * A darker (`amount` < 0, down to −1) or lighter (> 0, up to 1) version of a colour, hue-shifted as painted pixel
 * art is: darker drifts toward blue-violet, lighter toward warm yellow; greys only darken or lighten.
 */
export function shade(color: ColorInput, amount: number): string {
  const flat = toHex(hex(color).map((v) => (amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  const [h, s, l] = toHsl(flat);
  if (s < 0.08) return flat;
  const turn = Math.abs(amount);
  return hsl(
    hueToward(h, amount < 0 ? 250 : 55, turn * 24),
    s + (amount < 0 ? 0.05 : -0.05) * Math.min(1, turn * 3),
    l,
  );
}

/** The colour `t` of the way from `a` to `b` (0 gives `a`, 1 gives `b`), mixed per byte. */
export function mix(a: ColorInput, b: ColorInput, t: number): string {
  const to = hex(b);
  return toHex(hex(a).map((v, i) => lerp(v, to[i], t)));
}

/**
 * Five shades of a colour for painted-looking art: shadows drift toward blue-violet, highlights toward warm yellow,
 * by `strength` (0–2, default 1). Skin, sand and cream get dusky rather than orange-red shadows.
 */
export function tones(color: string, strength = 1): Tones {
  const [h, s, l] = toHsl(color);
  const k = strength;
  const grey = s < 0.08;
  const f = (dl: number, dh: number, target: number, ds: number) =>
    grey ? hsl(h, s, l + dl * k) : hsl(hueToward(h, target, dh * k), s + ds, l + dl * k);
  const skin = !grey && l > 0.62 && (h < 50 || h > 340);
  return {
    deep: skin ? f(-0.3, 22, 280, -0.22) : f(-0.3, 16, 250, 0.06),
    sh: skin ? f(-0.14, 14, 280, -0.16) : f(-0.15, 9, 250, 0.05),
    base: color,
    lt: f(0.1, 6, 50, -0.02),
    hi: f(0.24, 12, 55, -0.08),
  };
}

/** `n` colours from dark to light around a colour (hue-shifted like `tones`), for palettes and gradients. */
export function ramp(color: string, n = 5, strength = 1): string[] {
  const [h, s, l] = toHsl(color);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = n < 2 ? 0 : (i / (n - 1)) * 2 - 1;
    const light = l + u * 0.3 * strength;
    if (s < 0.08) {
      out.push(hsl(h, s, light));
      continue;
    }
    const hue = hueToward(h, u < 0 ? 250 : 55, Math.abs(u) * 14 * strength);
    out.push(hsl(hue, s + (u < 0 ? 0.06 : -0.06) * Math.abs(u), light));
  }
  return out;
}

const scratch = new Color();

/** A colour as linear RGB floats (0–1), as three.js's `Color` holds a hex given to it: for shaders and instances. */
export function toLinear(color: ColorInput): Rgb {
  const [r, g, b] = hex(color);
  scratch.setRGB(r / 255, g / 255, b / 255, 'srgb');
  return [scratch.r, scratch.g, scratch.b];
}

/** Linear RGB floats as `#rrggbb` (sRGB, rounded and clamped), as three.js's `Color.getHexString` writes them. */
export function fromLinear(rgb: readonly number[]): string {
  return '#' + scratch.setRGB(rgb[0], rgb[1], rgb[2]).getHexString();
}
