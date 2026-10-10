/**
 * @file The legend registry (PLAN.md WP 2.2, §6.6, I-22): the registry kind `glyph`, one entry per character a level
 * map may hold, saying what that character means: its floor and top heights, whether it is solid, its collider and
 * mesh recipes, nav flags, a spawn point, a light spot, a surface tag and its footprint. The level compiler
 * (engine/world/level/compile.ts) reads only these fields, never an id (ask the entry, §6.6), so a new glyph works in
 * every level without editing the compiler.
 *
 * `defineGlyph(id, spec)` adds one (a game's own glyphs live with the game: `labs/box/`, never the engine).
 * `legendOf(registry)` maps each character to its glyph. A registry gets the kind, and the engine's v1 glyphs
 * (engine/world/level/legend.ts), the first time anything here touches it; the shared registry gets them on import.
 *
 * Invariants: a glyph's `char` is one character (one code point), not whitespace, and no other glyph's; `top` is at
 * least `floor`; a solid glyph is not walkable (`nav.walkable: false`); spawn names and light tags are words
 * (letters, digits, `_`, `-`). Problems raise `CORE_BAD_SPEC` naming each, as every registry kind does.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineGlyph('glyph:crateSpot', { char: 'c', description: 'Floor where a crate starts.', mesh: 'floor', spawn: 'crate' }, reg);
 * legendOf(reg).get('c')?.spawn; // 'crate'
 * legendOf(reg).get('#')?.top; // 3: the v1 wall, there without defining it
 * @see engine/world/level/glyph.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { Schema, SpecOf } from '../../core/schema';
import { V1_GLYPHS } from './legend';

/** The fields of a `glyph` entry. */
export const GLYPH_FIELDS = {
  char: {
    type: 'string',
    required: true,
    description: 'The one character that writes the glyph in a level map (one code point; not a space or a tab).',
  },
  description: { type: 'string', default: '', description: 'What the glyph is, in plain sentences.' },
  floor: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description: "The walkable surface's height on its tiles: what floorHeight returns there (the prototype's floorH).",
  },
  top: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description:
      "The top of what stands on its tiles, at least floor: a wall's top, the floor's height on open tiles; what topHeight returns there (topH).",
  },
  solid: {
    type: 'boolean',
    default: false,
    description: 'Whether it blocks movement at ground level: its tiles fill the solid grid, and nobody walks through.',
  },
  collider: {
    type: 'string',
    enum: ['none', 'box'],
    default: 'none',
    description:
      "The collider recipe: 'box' is a box from the ground (y 0) to top over its tiles, merged with touching tiles of the same glyph into few boxes (greedy, rows first); 'none' adds none. WP 4.2 adds hulls.",
  },
  mesh: {
    type: 'string',
    default: 'none',
    description:
      "The mesh recipe the level meshes (WP 2.4) build for its tiles: 'floor', 'wall', 'lowWall', 'pillar'; 'none' for nothing.",
  },
  nav: {
    type: 'object',
    default: { walkable: true, standable: false },
    description: 'Navigation flags, for the walkable grid (WP 4.3) and the reachability checks of validateLevel.',
    properties: {
      walkable: {
        type: 'boolean',
        default: true,
        description: 'Bodies walk across its tiles at its floor height. A solid glyph is never walkable.',
      },
      standable: {
        type: 'boolean',
        default: false,
        description: 'A body may jump onto its top and stand there, as on a low wall.',
      },
    },
  },
  spawn: {
    type: 'string',
    default: '',
    description:
      "The spawn point its tiles mark, by name: 'hero' gives spawn:hero at each such tile's centre, on its floor. '' for none.",
  },
  light: {
    type: 'string',
    default: '',
    description: "The light spot its tiles hold, by tag ('torch'), where the lights (WP 7.1) go; '' for none.",
  },
  lightHeight: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description: "The light spot's height above the tile's top.",
  },
  surface: {
    type: 'string',
    default: 'stone',
    description: 'The surface tag of its tiles, for footsteps, particles and friction.',
  },
  footprint: {
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 8,
    description:
      'Its footprint in tiles: a block of it fills whole footprint × footprint squares, each one piece (a pillar is 2: PP over PP).',
  },
} as const satisfies Schema;

/** A `glyph` entry: what one map character means. */
export type Glyph = Entry<typeof GLYPH_FIELDS>;

/** What `defineGlyph` takes: `char`, and any other field (`nav` may give one flag, the other keeping its default). */
export type GlyphSpec = Omit<SpecOf<typeof GLYPH_FIELDS>, 'nav'> & {
  nav?: { walkable?: boolean; standable?: boolean };
};

/** A spawn name or light tag: a word. */
const WORD = /^[A-Za-z0-9_-]+$/;

/** The problems of a glyph beyond its fields: its character, heights, flags and names, read against `registry`. */
function glyphProblems(glyph: Glyph, registry: Registry): string[] {
  const problems: string[] = [];
  const chars = [...glyph.char];
  if (chars.length !== 1) {
    problems.push(`char is ${JSON.stringify(glyph.char)}; it must be exactly one character`);
  } else if (/^\s$/u.test(glyph.char) || /^\p{Cc}$/u.test(glyph.char)) {
    problems.push(`char is ${JSON.stringify(glyph.char)}; a map character cannot be whitespace or a control character`);
  } else {
    const other = registry.list('glyph').find((entry) => entry.char === glyph.char && entry.id !== glyph.id);
    if (other) problems.push(`char "${glyph.char}" already writes ${other.id}; pick another character`);
  }
  if (glyph.top < glyph.floor) problems.push(`top ${glyph.top} is below floor ${glyph.floor}; top is at least floor`);
  if (glyph.solid && glyph.nav.walkable) {
    problems.push('a solid glyph is not walkable: add nav: { walkable: false } (or make it solid: false)');
  }
  if (glyph.spawn && !WORD.test(glyph.spawn)) {
    problems.push(`spawn "${glyph.spawn}" must be a word (letters, digits, _ and -)`);
  }
  if (glyph.light && !WORD.test(glyph.light)) {
    problems.push(`light "${glyph.light}" must be a word (letters, digits, _ and -)`);
  }
  if (glyph.collider === 'box' && glyph.top <= 0) {
    problems.push(
      "a box collider needs a top above 0 (it is a box from the ground to top): set top, or collider: 'none'",
    );
  }
  if (!glyph.mesh) problems.push("mesh is empty; name a recipe, or 'none'");
  return problems;
}

/** Declares the kind `glyph` on `registry`, with the engine's v1 glyphs, unless it has it. */
export function glyphKind(registry: Registry): void {
  if (registry.kinds().includes('glyph')) return;
  registry.defineKind('glyph', {
    description:
      'Level legend glyphs: what one map character means (heights, solid, collider and mesh recipes, nav flags, spawn, light spot, surface, footprint).',
    fields: GLYPH_FIELDS,
    defineWith: "defineGlyph('<id>', { char: '<one character>', description: '…', … })",
    check: (entry) => glyphProblems(entry as Glyph, registry),
  });
  for (const [id, spec] of Object.entries(V1_GLYPHS)) registry.def('glyph', id, spec);
}
glyphKind(sharedRegistry);

/**
 * Defines a glyph on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (a character another glyph writes, top below floor, a walkable solid…), `CORE_DUPLICATE_ID` when defined
 * twice. Define a level's glyphs before compiling it.
 */
export function defineGlyph(id: string, spec: GlyphSpec, registry: Registry = sharedRegistry): Glyph {
  glyphKind(registry);
  return registry.def('glyph', id, spec as unknown as Record<string, unknown>) as unknown as Glyph;
}

/** Every glyph of `registry` (the shared one by default), keyed by its character, in id order. */
export function legendOf(registry: Registry = sharedRegistry): Map<string, Glyph> {
  glyphKind(registry);
  return new Map(registry.list('glyph').map((entry) => [(entry as Glyph).char, entry as Glyph]));
}
