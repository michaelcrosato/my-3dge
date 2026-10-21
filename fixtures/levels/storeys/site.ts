/**
 * @file The storey fixtures as a site (PLAN.md WP 13.15), for the engine's site tests (Node only: it reads the
 * fixtures' files): `defineFixtureSite(registry)` defines the fixtures' room markers (glyphs.ts), the house and the
 * shed as levels, a 32 × 32 m terrain lot and `site:fixture-lot`, the house's map at (10, 0, 12) and the shed's at
 * (24, 0, 6) turned a quarter, as labs/playground/scenes/lot.ts stands its copies; it returns the site made.
 *
 * @example
 * import { createRegistry } from '../../../engine/core/registry';
 * defineFixtureSite(createRegistry()).structures.map((s) => s.footprint); // [[10, 12, 18, 18], [24, 3, 28, 6]]
 * @see engine/world/site.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineLevel, defineSite, defineTerrain, getSite, type Site } from '../../../engine/sim-api';
import { defineStoreyFixtureGlyphs } from './glyphs';

/** Defines the fixture site and what it stands on `registry` (the shared one by default); the site made. */
export function defineFixtureSite(registry?: Parameters<typeof defineLevel>[2]): Site {
  defineStoreyFixtureGlyphs(registry);
  for (const name of ['house', 'shed']) {
    const text = readFileSync(join(import.meta.dirname, `${name}.txt`), 'utf8');
    defineLevel(`level:fixture-${name}`, { text, file: `fixtures/levels/storeys/${name}.txt` }, registry);
  }
  defineTerrain('terrain:fixture-lot', { size: [32, 32], seed: 3, height: 0.4, scale: 12 }, registry);
  defineSite(
    'site:fixture-lot',
    {
      terrain: 'terrain:fixture-lot',
      structures: [
        { level: 'level:fixture-house', at: [10, 0, 12] },
        { level: 'level:fixture-shed', at: [24, 0, 6], turn: 1 },
      ],
    },
    registry,
  );
  return getSite('site:fixture-lot', registry);
}
