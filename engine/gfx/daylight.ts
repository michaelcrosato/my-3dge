/**
 * @file The sky by the hour (PLAN.md WP 13.23; docs/PLAYGROUND.md §8.2): what a scene's clock (engine/sim/lights.ts)
 * looks like. `daylightAt(hour)` gives a `sky` entry (engine/gfx/sky.ts) blended from the two key skies about the
 * hour (`DAYLIGHT`: `sky:night`, `sky:dawn`, `sky:noon` and `sky:dusk`, smoothly over the hours between): the
 * background, the dome's haze and exposure, the ambient light, the fog and the backdrop's tint, each number and
 * colour eased from one key to the next (colours through three.js's working, linear space). The light comes from
 * `lightAt(hour)`, not the keys: the sun on its arc from 6 to 18 (rising in the east, +X, highest in the south, +Z,
 * setting in the west) and the moon on its arc through the night, each fading in its last 17° above the horizon, and
 * held 7° above it at least, so the shadows never stretch across the whole site. The stage's sky shows the blend
 * while a scene runs a clock (engine/gfx/stageSky.ts).
 *
 * Why the moon, and why the lamps always shine: who casts shadows is part of every lit shader's key (shadows.ts), and
 * r182 builds the pipelines again on every change (engine/gfx/pipelines.ts), so a day that put its sun out at night
 * or its lamps out by day would warm up twice a day. The sun's light never goes out: at the hour the sun sets and
 * the moon rises it is at its dimmest, a twenty-fifth of the key's, so the light's jump from west to east goes unseen.
 * Every key lights the light pool fully (`pointLights` 1): a lamp is lit by its switch (engine/sim/switches.ts), not
 * the hour.
 *
 * Invariants: presentation only, never in the hash: a pure function of the hour and the registry's key skies; equal
 * hours give equal entries; every hour's light casts and every hour's lamps shine, so the cycle never changes a
 * shader's key.
 *
 * @example
 * lightAt(12).body; // 'sun': highest in the south
 * lightAt(0).body; // 'moon'
 * daylightAt(12).sun.intensity; // 2.6: noon's sun at its height
 * daylightAt(21).pointLights; // 1: the lamps shine as their switches say
 * @see engine/gfx/daylight.test.ts
 * @see tests/e2e/lights.spec.ts
 */
import { Color } from 'three/webgpu';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { defineSkies, type SkyEntry, type SkySpec } from './sky';

/** The key skies by the hour (0 to 24): between two, the sky eases from one to the next. */
export const DAYLIGHT = [
  [0, 'sky:night'],
  [4.5, 'sky:night'],
  [6, 'sky:dawn'],
  [8.5, 'sky:noon'],
  [15.5, 'sky:noon'],
  [18, 'sky:dusk'],
  [19.5, 'sky:night'],
  [24, 'sky:night'],
] as const;

/** The sun's day (hours): it rises at `rise` and sets at `set`; the moon has the rest. */
export const SUN = { rise: 6, set: 18, height: 1.15, moon: 0.9, lowest: 0.12, fade: 0.3, dimmest: 0.04 } as const;

/** The key skies (see the file comment), in the shape `defineSky` takes. */
const KEYS: Record<string, SkySpec> = {
  'sky:noon': {
    description: 'Noon by the clock: a clear sky dome, the sun high in the south, the lamps lit by their switches.',
    background: '#9cc4ec',
    pointLights: 1,
    dome: { show: true, turbidity: 2, rayleigh: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.5 },
    sun: { color: '#fff0d8', intensity: 2.6 },
    ambient: { sky: '#c8d4ff', ground: '#4a3f30', intensity: 1.6 },
    fog: { color: '#c8daf0', start: 40, end: 220, amount: 0.5 },
  },
  'sky:dawn': {
    description: 'Dawn by the clock: a pink, hazy sky, the sun low in the east.',
    background: '#e0b8b0',
    pointLights: 1,
    dome: { show: true, turbidity: 6, rayleigh: 2.5, mieCoefficient: 0.01, mieDirectionalG: 0.85, exposure: 0.32 },
    sun: { color: '#ffc8a0', intensity: 1.8 },
    ambient: { sky: '#e6c8d0', ground: '#3a3028', intensity: 1.1 },
    fog: { color: '#e8d0c8', start: 30, end: 200, amount: 0.6 },
  },
  'sky:dusk': {
    description: 'Dusk by the clock: an orange sky, the sun setting in the west.',
    background: '#e09060',
    pointLights: 1,
    dome: { show: true, turbidity: 6, rayleigh: 3, mieCoefficient: 0.012, mieDirectionalG: 0.85, exposure: 0.28 },
    sun: { color: '#ff9a60', intensity: 1.6 },
    ambient: { sky: '#e0b0a0', ground: '#2e2620', intensity: 0.9 },
    fog: { color: '#d8a890', start: 30, end: 200, amount: 0.55 },
  },
  'sky:night': {
    description: 'Night by the clock: a dark blue sky, the moon, the lamps and the street lit by their switches.',
    background: '#0a1024',
    pointLights: 1,
    dome: { show: true, turbidity: 2, rayleigh: 1, mieCoefficient: 0.003, mieDirectionalG: 0.8, exposure: 0.04 },
    sun: { color: '#a8b8ff', intensity: 0.5 },
    ambient: { sky: '#5a6aa0', ground: '#18141c', intensity: 0.55 },
    fog: { color: '#101830', start: 30, end: 180, amount: 0.7 },
  },
};

/** The backdrop's tint by key (the silhouettes darken at night); the rest of the backdrop is sky:daylight's. */
const TINTS: Record<string, string> = { 'sky:noon': '#ffffff', 'sky:dawn': '#e0c8c0', 'sky:dusk': '#d0a088', 'sky:night': '#2a3048' }; // prettier-ignore

/** Declares the key skies on `registry`, unless it has them, the backdrop sky:daylight's under each key's tint. */
export function defineDaylight(registry: Registry = sharedRegistry): void {
  defineSkies(registry);
  const day = registry.get('sky', 'sky:daylight') as SkyEntry;
  for (const [id, spec] of Object.entries(KEYS)) {
    if (!registry.has('sky', id)) registry.def('sky', id, { ...spec, backdrop: { ...day.backdrop, tint: TINTS[id] } });
  }
}
defineDaylight();

/** Where the light stands at `hour` (radians, as a sky's sun takes them), how strongly it shines (0 to 1), and whose. */
export function lightAt(hour: number): { azimuth: number; elevation: number; strength: number; body: 'sun' | 'moon' } {
  const h = ((hour % 24) + 24) % 24;
  const day = h >= SUN.rise && h < SUN.set;
  const span = day ? SUN.set - SUN.rise : 24 - (SUN.set - SUN.rise);
  const t = (day ? h - SUN.rise : (h - SUN.set + 24) % 24) / span; // 0 rising in the east, 1 setting in the west
  const height = Math.sin(Math.PI * t);
  return {
    azimuth: Math.PI / 2 - Math.PI * t,
    elevation: Math.max(SUN.lowest, (day ? SUN.height : SUN.moon) * height),
    strength: Math.min(1, Math.max(SUN.dimmest, height / Math.sin(SUN.fade))),
    body: day ? 'sun' : 'moon',
  };
}

/** `a` eased toward `b` by `t` (0 to 1), field by field: numbers and colours, the rest `a`'s until halfway. */
function blend<T>(a: T, b: T, t: number): T {
  if (t <= 0 || t >= 1) return t <= 0 ? a : b; // a key's hour gives the key itself
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * t) as unknown as T;
  if (typeof a === 'string' && typeof b === 'string' && /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b))
    return `#${new Color(a).lerp(new Color(b), t).getHexString()}` as unknown as T;
  if (a && b && typeof a === 'object' && !Array.isArray(a)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(a)) out[key] = blend((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], t); // prettier-ignore
    return out as T;
  }
  return t < 0.5 ? a : b;
}

/** The sky at `hour` (see the file comment): the key skies about it blended, the light where `lightAt` puts it. */
export function daylightAt(hour: number, registry: Registry = sharedRegistry): SkyEntry {
  const h = ((hour % 24) + 24) % 24;
  const next = DAYLIGHT.findIndex(([at]) => at > h);
  const [[h0, k0], [h1, k1]] = [DAYLIGHT[next - 1], DAYLIGHT[next]];
  const x = (h - h0) / (h1 - h0);
  const eased = x * x * (3 - 2 * x);
  const entry = blend(registry.get('sky', k0) as SkyEntry, registry.get('sky', k1) as SkyEntry, eased);
  const light = lightAt(h);
  const sun = { ...entry.sun, azimuth: light.azimuth, elevation: light.elevation, intensity: entry.sun.intensity * light.strength }; // prettier-ignore
  return { ...entry, id: `daylight@${h.toFixed(2)}`, sun };
}
