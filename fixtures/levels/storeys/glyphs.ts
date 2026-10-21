/**
 * @file The storey fixtures' own glyphs (PLAN.md WP 13.13): a room marker for each room of fixtures/levels/storeys/
 * house.txt, as a game defines its rooms (the engine names none). `defineStoreyFixtureGlyphs(registry)` adds them to a
 * registry, the shared one by default; `node x qa level` and the level tests read the house with them.
 *
 * @example
 * import { createRegistry } from '../../../engine/core/registry';
 * const reg = createRegistry();
 * defineStoreyFixtureGlyphs(reg);
 * reg.get('glyph', 'glyph:fixture-kitchen').room; // 'kitchen'
 * @see engine/world/level/storeys.test.ts
 */
import { defineGlyph } from '../../../engine/sim-api';

/** The rooms of house.txt by marker character. */
export const FIXTURE_ROOMS = {
  c: 'cellar',
  h: 'hall',
  k: 'kitchen',
  b: 'bedroom',
  s: 'study',
  a: 'attic',
} as const;

/** Defines a floor glyph marking each fixture room on `registry` (the shared one by default). */
export function defineStoreyFixtureGlyphs(registry?: Parameters<typeof defineGlyph>[2]): void {
  for (const [char, room] of Object.entries(FIXTURE_ROOMS)) {
    const description = `Floor marking the ${room} (a storey fixture's room).`;
    defineGlyph(`glyph:fixture-${room}`, { char, description, mesh: 'floor', room }, registry);
  }
}
