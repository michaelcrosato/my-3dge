/**
 * @file Levels as registry entries (PLAN.md WP 2.2, §6.6, §6.9): the registry kind `level`, so a scene names its level
 * by id (`defineScene('box:room', { level: 'level:room', … })`, engine/sim/scene.ts) and `x describe level` lists
 * them. `defineLevel(id, { text, file })` registers a level's text after checking it compiles; `getLevel(id)` compiles
 * the registered text (engine/world/level/compile.ts) and returns the plain data.
 *
 * Where the text comes from is the caller's business: a page imports a level file with Vite's `?raw`, and a test or a
 * tool reads it. The entry keeps the text, never the compiled data, so the registry stays small and `getLevel`
 * reflects the legend of the registry it reads.
 *
 * Invariants: an entry's text compiles against its registry's legend when it is defined (`CORE_BAD_SPEC` naming each
 * structural problem otherwise), so define a level's own glyphs first. `getLevel` compiles afresh on each call, a
 * pure function of the entry and the legend (no cache, no module state), so equal calls give equal data.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineLevel('level:cell', { text: '#####\n#@..#\n#####\n', file: 'cell.txt' }, reg);
 * getLevel('level:cell', reg).spawns.map((spawn) => spawn.id); // ['spawn:hero']
 * reg.describe('level').ids; // ['level:cell']
 * @see engine/world/level/level.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { Schema, SpecOf } from '../../core/schema';
import { compileLevel } from './compile';
import type { CompiledLevel } from './types';
import { checkLevel } from './validate';

/** The fields of a `level` entry. */
export const LEVEL_FIELDS = {
  text: {
    type: 'string',
    required: true,
    description:
      "The level's text: optional front matter, then the map (engine/world/level/parse.ts gives the format).",
  },
  file: {
    type: 'string',
    default: '',
    description: 'The file the text came from (labs/box/levels/room.txt), for messages; the id stands in when empty.',
  },
} as const satisfies Schema;

/** A `level` entry: a level's text and where it came from. */
export type LevelEntry = Entry<typeof LEVEL_FIELDS>;

/** Declares the kind `level` on `registry` unless it has it. */
function levelKind(registry: Registry): void {
  if (registry.kinds().includes('level')) return;
  registry.defineKind('level', {
    description:
      'Levels: a level text (front matter and a map in legend characters) that compileLevel turns into data.',
    fields: LEVEL_FIELDS,
    defineWith: "defineLevel('<id>', { text, file })",
    check: (entry) => {
      const level = entry as LevelEntry;
      const { problems } = checkLevel(level.text, { file: level.file || level.id, registry });
      return problems.map((problem) => problem.message);
    },
  });
}
levelKind(sharedRegistry);

/**
 * Registers a level on `registry` (the shared one by default) after checking its text compiles against that
 * registry's legend; returns the entry. Throws `CORE_BAD_SPEC` naming each structural problem at its line and column,
 * `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineLevel(
  id: string,
  spec: SpecOf<typeof LEVEL_FIELDS>,
  registry: Registry = sharedRegistry,
): LevelEntry {
  levelKind(registry);
  return registry.def('level', id, spec as unknown as Record<string, unknown>) as unknown as LevelEntry;
}

/**
 * The level `id` of `registry` (the shared one by default), compiled: its name is the id without `level:`. Throws
 * `CORE_NO_ENTRY` naming the closest ids for a missing one.
 */
export function getLevel(id: string, registry: Registry = sharedRegistry): CompiledLevel {
  levelKind(registry);
  const entry = registry.get('level', id) as LevelEntry;
  return compileLevel(entry.text, {
    file: entry.file || entry.id,
    name: entry.id.replace(/^level:/, ''),
    registry,
  });
}
