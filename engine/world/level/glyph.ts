/**
 * @file The legend registry (PLAN.md WP 2.2, WP 13.13, §6.6, I-22): the registry kind `glyph`, one entry per
 * character a level map may hold, saying what that character means: its floor and top heights and how its floor runs
 * (flat, a ramp, a dais, a flight of stairs to the storey above), whether it is solid, its collider and mesh recipes,
 * nav flags, a spawn point, a light spot, a surface tag, whether a ladder stands on it and its footprint; and for
 * levels written as storeys (format 2), void, full height, an opening (a door or a window), a head and a room marker
 * (`STOREY_FIELDS`, which a format-1 level's legend leaves out). The level compiler (engine/world/level/compile.ts)
 * reads only these fields, never an id (ask the entry, §6.6), so a new glyph works in every level without editing
 * the compiler.
 *
 * `defineGlyph(id, spec)` adds one (a game's own glyphs live with the game: `labs/box/`, never the engine).
 * `legendOf(registry)` maps each character to its glyph. A registry gets the kind, and the engine's v1 to v4 glyphs
 * (engine/world/level/legend.ts), the first time anything here touches it; the shared registry gets them on import.
 *
 * Invariants: a glyph's `char` is one character (one code point), not whitespace, and no other glyph's; `top` is at
 * least `floor`; a solid glyph is not walkable (`nav.walkable: false`); spawn names, light tags and room names are
 * words (letters, digits, `_`, `-`); a ladder is not solid. A ramp or a dais rises (`top` above `floor`), is walked
 * on (not solid) and has a hull collider or none, a dais an `edge` above 0; a hull collider follows a ramp, a dais or
 * a flight; a cylinder collider has a `radius` and a `top` above `floor`. A void tile is neither solid nor walkable
 * and has no collider; a full glyph is a solid box; a door is walked through under a head, a window is a solid box to
 * its sill with its head above; a head stands above what stands on its tiles; a room marker is walkable floor.
 * Problems raise `CORE_BAD_SPEC` naming each, as every registry kind does.
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
import { V1_GLYPHS, V2_GLYPHS, V3_GLYPHS, V4_GLYPHS } from './legend';

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
    enum: ['none', 'box', 'hull', 'cylinder'],
    default: 'none',
    description:
      "The collider recipe: 'box' is a box from the ground (y 0) to top over its tiles, merged with touching tiles of the same glyph into few boxes (greedy, rows first); 'hull' a convex hull under a ramp (a wedge) or a dais (a frustum), from the ground; 'cylinder' an upright cylinder of radius at each tile's centre, from floor to top; 'none' adds none.",
  },
  floorShape: {
    type: 'string',
    enum: ['flat', 'ramp', 'dais', 'flight'],
    default: 'flat',
    description:
      "How its floor runs: 'flat' at floor; 'ramp' rising in a straight slope from floor to top across each filled rectangle of its tiles, toward the one side whose neighbours stand at top (stairs up to a gallery); 'dais' an octagonal platform on each square block of its tiles, its edge sloping from floor to top; 'flight' (format 2) stairs rising from floor to the floor of the storey above, toward the one side that floor meets.",
  },
  edge: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description: "A dais's sloped edge, measured across: its top's faces stand this far inside its base's.",
  },
  radius: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description: "A cylinder collider's radius.",
  },
  mesh: {
    type: 'string',
    default: 'none',
    description:
      "The mesh recipe the level meshes (WP 2.4) build for its tiles: 'floor', 'wall', 'lowWall', 'pillar', 'gallery', 'stairs', 'ramp', 'dais', 'brazier'; 'none' for nothing.",
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
  ladder: {
    type: 'boolean',
    default: false,
    description:
      "A ladder stands on its tiles against the neighbouring tile that stands highest, up to that tile's top, climbed from its tiles (engine/world/traverse.ts's levelLadders, WP 13.7). Not solid.",
  },
  footprint: {
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 8,
    description:
      'Its footprint in tiles: a block of it fills whole footprint × footprint squares, each one piece (a pillar is 2: PP over PP).',
  },
  void: {
    type: 'boolean',
    default: false,
    description:
      'Format 2: its tiles have no floor on their storey (a stairwell, a double height, the air beside a building). Not solid, not walkable, no collider.',
  },
  full: {
    type: 'boolean',
    default: false,
    description:
      "Format 2: its box rises from its storey's floor to the floor of the storey above (or to the roof over it), whatever its top: a wall, a pillar. A format-1 level reads its top.",
  },
  opening: {
    type: 'string',
    enum: ['none', 'door', 'window'],
    default: 'none',
    description:
      "Format 2: an opening in a wall, drawn as a filled rectangle one wall thick with the wall at both ends: 'door' walked through under its head; 'window' solid below its sill (its box, from the floor to top) and open up to its head.",
  },
  head: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description:
      "Format 2: a solid from this height over its floor up to its storey's full top: a door's or a window's head, a low ceiling (a crawlspace); 0 for none.",
  },
  room: {
    type: 'string',
    default: '',
    description:
      "Format 2: a room marker: the room, by name, its tiles' floor inside walls and openings ('' for none). One marker per room.",
  },
} as const satisfies Schema;

/** The fields only format 2 reads: a format-1 level's legend leaves them out (engine/world/level/compile.ts). */
export const STOREY_FIELDS = ['void', 'full', 'opening', 'head', 'room'] as const;

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
  if (glyph.ladder && glyph.solid) problems.push('a ladder is climbed from its tiles: make it solid: false');
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
  problems.push(...shapeProblems(glyph), ...storeyProblems(glyph));
  if (!glyph.mesh) problems.push("mesh is empty; name a recipe, or 'none'");
  return problems;
}

/** The problems of a glyph's format-2 fields: void, full, an opening, a head and a room marker. */
function storeyProblems(glyph: Glyph): string[] {
  const problems: string[] = [];
  if (glyph.void && (glyph.solid || glyph.nav.walkable || glyph.collider !== 'none' || glyph.floorShape !== 'flat')) {
    problems.push("a void tile has no floor: make it solid: false, nav: { walkable: false }, collider: 'none', flat");
  }
  if (glyph.full && !(glyph.solid && glyph.collider === 'box')) {
    problems.push("full fills its storey with its box: make it solid: true with collider: 'box'");
  }
  if (
    glyph.opening === 'door' &&
    (glyph.solid || !glyph.nav.walkable || glyph.collider !== 'none' || !(glyph.head > 0))
  ) {
    problems.push(
      "a door is walked through under its head: make it solid: false, walkable, collider: 'none', with a head above 0",
    );
  }
  if (
    glyph.opening === 'window' &&
    !(glyph.solid && glyph.collider === 'box' && glyph.top > 0 && glyph.head > glyph.top)
  ) {
    problems.push(
      "a window is solid to its sill (top) and open up to its head: make it solid, collider: 'box', top above 0 and head above top",
    );
  }
  if (glyph.head > 0 && glyph.head <= Math.max(glyph.floor, glyph.top)) {
    problems.push(`head ${glyph.head} is not above what stands on its tiles (${Math.max(glyph.floor, glyph.top)} m)`);
  }
  if (glyph.room && (glyph.void || glyph.solid || !glyph.nav.walkable)) {
    problems.push("a room marker stands on the room's floor: make it walkable, not solid and not void");
  }
  if (glyph.room && !WORD.test(glyph.room))
    problems.push(`room "${glyph.room}" must be a word (letters, digits, _ and -)`);
  return problems;
}

/** The problems of a glyph's floor shape and of its hull or cylinder collider. */
function shapeProblems(glyph: Glyph): string[] {
  const problems: string[] = [];
  const shape = glyph.floorShape;
  if (shape !== 'flat') {
    if (glyph.top <= glyph.floor && shape !== 'flight') {
      problems.push(`a ${shape} rises: give it a top above its floor (${glyph.floor})`);
    }
    if (glyph.solid) problems.push(`a ${shape} is walked on: it cannot be solid`);
    if (glyph.collider === 'box' || glyph.collider === 'cylinder') {
      problems.push(`a ${shape}'s collider is 'hull' (under its slope) or 'none', not '${glyph.collider}'`);
    }
  }
  if (shape === 'dais' && glyph.edge <= 0) problems.push('a dais needs an edge above 0: its sloped edge, across (m)');
  if (glyph.collider === 'hull' && shape === 'flat') {
    problems.push(
      "a hull collider follows the floor's slope: give it floorShape: 'ramp', 'dais' or 'flight', or collider: 'box'",
    );
  }
  if (glyph.collider === 'cylinder') {
    if (glyph.radius <= 0) problems.push('a cylinder collider needs a radius above 0 (m)');
    if (glyph.top <= glyph.floor)
      problems.push('a cylinder collider stands from floor to top: give it a top above its floor');
  }
  return problems;
}

/** Declares the kind `glyph` on `registry`, with the engine's v1 to v4 glyphs, unless it has it. */
export function glyphKind(registry: Registry): void {
  if (registry.kinds().includes('glyph')) return;
  registry.defineKind('glyph', {
    description:
      'Level legend glyphs: what one map character means (heights, floor shape, solid, collider and mesh recipes, nav flags, spawn, light spot, surface, footprint; in a storey, void, full height, openings, heads and room markers).',
    fields: GLYPH_FIELDS,
    defineWith: "defineGlyph('<id>', { char: '<one character>', description: '…', … })",
    check: (entry) => glyphProblems(entry as Glyph, registry),
  });
  for (const [id, spec] of Object.entries({ ...V1_GLYPHS, ...V2_GLYPHS, ...V3_GLYPHS, ...V4_GLYPHS }))
    registry.def('glyph', id, spec);
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
