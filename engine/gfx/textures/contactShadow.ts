/**
 * @file Contact shadows and the level floor bake (PLAN.md WP 7.3, I-20): `levelFloorTexture(level, options)` returns
 * a texture generator for one compiled level's whole floor, baked once over every tile as the prototype baked the
 * hall's: a base texture (flagstones by default), moss creeping in from the foot of the walls
 * (engine/gfx/textures/generators/moss.ts), a rune circle on each dais, glowing in the emissive map
 * (engine/gfx/textures/generators/runes.ts), and a contact shadow, the soft dark band where a wall meets the floor,
 * baked into the colour. A game defines it as its own texture and draws the floor with it:
 * `defineTexture('texture:hallFloor', levelFloorTexture(hall))`, then a material whose `map` names it.
 *
 * Where it lands: the floor meshes' UVs are metres, u along X and v along −Z (engine/gfx/level/surface.ts), and the
 * bake repeats every `size / density` metres (engine/gfx/textures/dataTexture.ts), here exactly the level's extent.
 * So texel column x covers X from x / density, and texel row y (row 0 at the bottom) covers Z up to
 * (height − y) / density: the bake is the map seen from above, north up, and tile (c, r) owns a `density · tile`
 * texel square. The galleries, stairs and dais run the same UVs, so a material using the bake fits them too.
 *
 * What casts a contact shadow: a block standing from the ground on a neighbouring tile (its glyph's collider is a
 * `box`: walls, low walls, pillars, galleries) whose top rises at least `shadows.rise` above the tile's floor. The
 * shadow fades over `shadows.radius` metres from the block's foot by the distance to the nearest such block (so it
 * runs evenly along a wall and rounds an outer corner), in `steps` bands as pixel art shades, darkening the colour
 * and the glow by up to `strength` with a slight cool tint. Moss grows by the same distance, its cover falling from
 * `moss.cover` at the foot to 0 at `moss.reach`. Tiles under a block nobody walks on (walls, pillars, low walls) keep
 * the base at full shadow (nothing shows there); a gallery's walk is floor, shadowed by the walls above it.
 *
 * Carried from the hall floor's bake (`my-3d2dge:src/stress-world/10-hall.js:205-219, 266-287`: flagstones, the rune
 * circle as emissive, moss within 22 units of the walls, the contact shadow 5 units deep, 0.4 strong in five bands,
 * tinted 0.98 green and 1.02 blue), rewritten: for any level (the casters asked of each glyph, never by character),
 * the shadow by distance (the prototype took the larger of the four sides', leaving outer corners bare), moss by the
 * distance to any wall (the prototype measured to the map's border), periodic (one period is the whole level, so the
 * bake still checks as a tiling texture), and height, roughness and an emissive map from the base and the runes.
 *
 * Invariants: pure in the level, the options and the seed; precomputes its distance field once per bake; the base
 * must tile at the floor's size (a flagstone's 16 × 32 texels divide any level at 16 texels per metre); the floor is
 * at most 4096 texels on a side (`GFX_FLOOR_BAKE`).
 *
 * @example
 * // defineTexture('texture:hallFloor', levelFloorTexture(hall, { base: { texture: 'texture:flagstone' } }));
 * // bakeTexture('texture:hallFloor').width; // 1024: 64 m at 16 texels per metre
 * @see engine/gfx/textures/contactShadow.test.ts
 */
import type { Rgb } from '../../core/color';
import { codeError, defineCodes } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { CompiledLevel } from '../../world/level/types';
import { textureSampler } from './bake';
import { mossGrowth } from './generators/moss';
import { paintRune, runeCircle } from './generators/runes';
import { getTexture } from './texture';
import { palette, wrapIndex } from './tile';
import { textureSpec, type TextureSpec } from './types';

/** The codes of the level floor bake, with their fixes. */
export const CONTACT_SHADOW_CODES = defineCodes('gfx', {
  GFX_FLOOR_BAKE: {
    template: "level {level}'s floor cannot bake at {density} texels per metre: {reason}",
    fix: 'give levelFloorTexture a density that makes each {tile} m tile a whole number of texels and the floor at most 4096 texels on a side ({suggest} texels per metre fits)',
    doc: 'Raised by `levelFloorTexture` (engine/gfx/textures/contactShadow.ts) when a tile would not be a whole number of texels (texels would straddle tiles, and the contact shadows would not line up with the walls) or the floor would be more than 4096 texels on a side, the largest texture a bake makes.',
  },
});

/** How the contact shadow at the foot of a block looks. */
export interface ContactShadowOptions {
  /** How far it reaches from the block's foot (m); 0.3125 by default, 5 texels at 16 per metre. */
  radius?: number;
  /** How much it darkens at the foot, 0–1; 0.4 by default. */
  strength?: number;
  /** The bands it fades in; 5 by default, 0 for a smooth fade. */
  steps?: number;
  /** Multipliers on red, green and blue where it falls; [1, 0.98, 1.02] by default, a slight cool tint. */
  tint?: readonly [number, number, number];
  /** How far a block's top must rise above a tile's floor to cast onto it (m); 0.25 by default. */
  rise?: number;
}

/** How moss creeps in from the foot of the blocks. */
export interface FloorMossOptions {
  /** How far from a block's foot it grows (m); 1.375 by default. */
  reach?: number;
  /** Its cover at the foot, 0–1, falling to 0 at `reach`; 0.5 by default. */
  cover?: number;
  /** Its dark, mid and light greens, hex. */
  tones?: readonly [string, string, string];
}

/** The rune circle laid on each dais; sizes in metres. */
export interface FloorRuneOptions {
  /** The outer ring's radius (m), kept inside the dais's top; 3.375 by default. */
  radius?: number;
  /** The inner ring's radius (m); 2.6875 by default. */
  inner?: number;
  /** 4, 8, 16 (the default) or 32. */
  spokes?: number;
  /** The rings' and spokes' inlay, hex. */
  rune?: string;
  /** The runes and the centre, hex. */
  glow?: string;
  /** How brightly the rings and spokes glow, 0–1; 0.45 by default. */
  lineGlow?: number;
}

/** What a level's floor is baked from; every part may be left out. */
export interface LevelFloorOptions {
  /** The base texture: an id or `{ texture, params, seed }`; `'texture:flagstone'` by default. */
  base?: string | { texture: string; params?: Record<string, unknown>; seed?: number };
  /** Texels per metre; the base's density by default (16 for the engine's). */
  density?: number;
  /** The contact shadows, or false for none. */
  shadows?: ContactShadowOptions | false;
  /** The moss, or false for none. */
  moss?: FloorMossOptions | false;
  /** The rune circles on the daises, or false for none. */
  runes?: FloorRuneOptions | false;
  /** Where the base texture is defined; the shared registry by default. */
  registry?: Registry;
}

const SHADOWS: Required<ContactShadowOptions> = {
  radius: 0.3125,
  strength: 0.4,
  steps: 5,
  tint: [1, 0.98, 1.02],
  rise: 0.25,
};
const MOSS: Required<FloorMossOptions> = { reach: 1.375, cover: 0.5, tones: ['#3f5a44', '#4d6b4b', '#62805a'] };
const RUNES: Required<FloorRuneOptions> = {
  radius: 3.375,
  inner: 2.6875,
  spokes: 16,
  rune: '#2f7f82',
  glow: '#6fd6cc',
  lineGlow: 0.45,
};

/**
 * The distance (texels) from each texel's centre of a floor bake of `level` (`tpt` texels per tile, row 0 the south
 * edge) to the foot of the nearest block casting onto its tile, up to `reach` (Infinity past it), and 0 under a block.
 * A block is a tile whose glyph's collider is a box; it casts onto a tile whose floor its top rises `rise` above; a
 * block nobody walks on (a wall, a pillar, a low wall) covers its tile, while a gallery's walk is floor like any other.
 */
function footDistances(level: CompiledLevel, tpt: number, rise: number, reach: number): Float32Array {
  const { cols, rows } = level;
  const [width, height] = [cols * tpt, rows * tpt];
  const block = level.tiles.map((char) => level.legend[char].collider === 'box');
  const span = Math.ceil(reach / tpt);
  // Per tile, the blocks within `span` tiles that cast onto it, so open floor far from walls costs nothing.
  const casters = level.tiles.map((_, t) => {
    const [r, c] = [Math.floor(t / cols), t % cols];
    const found: [number, number][] = [];
    for (let nr = Math.max(0, r - span); nr <= Math.min(rows - 1, r + span); nr++) {
      for (let nc = Math.max(0, c - span); nc <= Math.min(cols - 1, c + span); nc++) {
        const n = nr * cols + nc;
        if (n !== t && block[n] && level.top[n] - level.floor[t] >= rise) found.push([nc, nr]);
      }
    }
    return found;
  });
  const out = new Float32Array(width * height).fill(Infinity);
  for (let y = 0; y < height; y++) {
    const mz = height - y - 0.5;
    const r = Math.floor(mz / tpt);
    for (let x = 0; x < width; x++) {
      const mx = x + 0.5;
      const t = r * cols + Math.floor(mx / tpt);
      if (block[t] && !level.walkable[t]) {
        out[y * width + x] = 0;
        continue;
      }
      let best = Infinity;
      for (const [nc, nr] of casters[t]) {
        const dx = Math.max(nc * tpt - mx, 0, mx - (nc + 1) * tpt);
        const dz = Math.max(nr * tpt - mz, 0, mz - (nr + 1) * tpt);
        best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
      }
      if (best <= reach) out[y * width + x] = best;
    }
  }
  return out;
}

/** The shadow at `d` texels from a block's foot (0–1), fading to 0 at `radius` texels in `steps` bands. */
export function contactShadow(d: number, radius: number, steps: number): number {
  const o = d < radius ? 1 - d / radius : 0;
  return steps > 0 ? Math.round(o * steps) / steps : o;
}

/** Throws `GFX_FLOOR_BAKE` unless `density` makes a whole number of texels per tile and a floor of 4096 or less. */
function texelsPerTile(level: CompiledLevel, density: number): number {
  const tpt = level.tile * density;
  const most = Math.max(level.cols, level.rows) * level.tile;
  const reason = !(Number.isInteger(tpt) && tpt > 0)
    ? `a ${level.tile} m tile would be ${tpt} texels`
    : most * density > 4096
      ? `its ${most} m side would be ${most * density} texels`
      : '';
  if (!reason) return tpt;
  const whole = Math.max(1, Math.min(Math.floor(4096 / Math.max(level.cols, level.rows)), Math.round(tpt) || 1));
  const suggest = whole / level.tile;
  throw codeError('GFX_FLOOR_BAKE', { level: level.name, density, reason, tile: level.tile, suggest });
}

/**
 * A texture generator for `level`'s whole floor: its base texture with moss at the walls' feet, rune circles on the
 * daises and contact shadows along every block's foot (see the file comment). Define it under an id of the game's
 * (`defineTexture`) and name it in a material's `map`. Throws `GFX_FLOOR_BAKE` for a density the level cannot bake
 * at, and `CORE_NO_ENTRY` for an unknown base texture.
 */
export function levelFloorTexture(level: CompiledLevel, options: LevelFloorOptions = {}): TextureSpec {
  const registry = options.registry ?? sharedRegistry;
  const base =
    typeof options.base === 'string' ? { texture: options.base } : (options.base ?? { texture: 'texture:flagstone' });
  const entry = getTexture(base.texture, registry);
  const density = options.density ?? entry.density;
  const tpt = texelsPerTile(level, density);
  const [w0, h0] = [level.cols * tpt, level.rows * tpt];
  const shadows = options.shadows === false ? null : { ...SHADOWS, ...options.shadows };
  const moss = options.moss === false ? null : { ...MOSS, ...options.moss };
  const runes = options.runes === false ? null : { ...RUNES, ...options.runes };
  const parts = [shadows && 'contact shadows', moss && 'moss', runes && level.daises.length && 'rune circles'];
  return textureSpec({
    description: `The floor of level ${level.name}, ${level.cols} × ${level.rows} tiles: ${base.texture} with ${parts.filter(Boolean).join(', ') || 'nothing more'}.`,
    size: [w0, h0],
    tile: () => [w0, h0],
    density,
    look: entry.look as TextureSpec['look'],
    create({ seed }) {
      const sampler = textureSampler({ ...base, seed: base.seed ?? seed, size: [w0, h0] }, registry);
      const shadowRadius = shadows ? shadows.radius * density : 0;
      const mossReach = moss ? moss.reach * density : 0;
      const distance = footDistances(level, tpt, shadows?.rise ?? SHADOWS.rise, Math.max(shadowRadius, mossReach));
      const grow = moss && mossGrowth([w0, h0], seed, palette(moss.tones, 'the floor moss') as [Rgb, Rgb, Rgb]);
      const tones = runes && {
        rune: palette([runes.rune], 'the floor runes')[0],
        glow: palette([runes.glow], 'the floor runes')[0],
        lineGlow: runes.lineGlow,
      };
      const circles = runes
        ? level.daises.map((dais) => {
            const radius = Math.min(runes.radius, dais.topRadius - 1 / density) * density;
            const inner = Math.min(runes.inner * density, radius - 2);
            // The centre on the texel corner nearest the dais's centre; j counts up from the bake's bottom row.
            const at = [Math.round(dais.center[0] * density), h0 - Math.round(dais.center[1] * density)];
            return { at, mark: runeCircle({ radius, inner, spokes: runes.spokes, seed }) };
          })
        : [];
      return (x, y, texel) => {
        const [px, py] = [wrapIndex(x, w0), wrapIndex(y, h0)];
        sampler.sample(px, py, texel);
        const d = distance[py * w0 + px];
        if (grow && d > 0 && d < mossReach) grow(texel, px, py, moss.cover * (1 - d / mossReach));
        for (const circle of circles) paintRune(texel, circle.mark(px - circle.at[0], py - circle.at[1]), tones!);
        if (!shadows) return;
        const o = contactShadow(d, shadowRadius, shadows.steps);
        if (!(o > 0)) return;
        const k = 1 - shadows.strength * o;
        for (let c = 0; c < 3; c++) {
          texel.color[c] = Math.min(255, texel.color[c] * k * shadows.tint[c]);
          texel.emissive[c] = Math.min(255, texel.emissive[c] * k * shadows.tint[c]);
        }
      };
    },
  }) as unknown as TextureSpec;
}
