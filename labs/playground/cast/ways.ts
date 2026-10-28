/**
 * @file The cast's ways about the block (docs/PLAYGROUND.md §7.4; PLAN.md WP 13.21): one navigation of the site a
 * world, round its props (engine/world/siteNav.ts `createSiteNav`, engine/sim/propBlocks.ts `propObstacles`), and flow
 * fields over it: `wayTo(w, key, goal)` keeps one a key (a neighbour's stop, the dog's goal), made again only when the
 * goal lies on another node, and lazy: flooded only as far as `direction` reads it, which answers as on a full field
 * (engine/world/siteNavGraph.ts), so the dog following the player across tiles floods a few metres, not the block. `plainWays()` is the site's alone, without a scene's props, for placing things in a
 * scene's setup, whose props no query sees yet.
 *
 * - The navigation is made the first time a step asks (`waysOf`), round the props as they stand then (the scene's
 *   setup can see none of them); a walker held by what its way does not know (a door opened onto it) has it made
 *   again round them as they stand now (`replanWays`), as the bot does. The boxes each went round are kept in the
 *   world with a count of the remakes (the component `siteWays`), so a world restored from a capture makes the very
 *   same ways the run had then, whatever the props did since.
 *
 * Invariants: derived data, apart from `siteWays`'s boxes (plain numbers, hashed and captured with the world); a field's
 * answers are a pure function of the navigation and its goal's node.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // stepping: const { nav, field } = wayTo(w, stop, stop.at); nav.direction(field, x, y, z);
 * @see labs/playground/cast/neighbours.test.ts
 */
import { createSiteNav, defineComponent, propObstacles, type NavBlock, type SiteNav, type World } from '../../../engine/sim-api'; // prettier-ignore
import { SITE } from '../levels/site';

defineComponent('siteWays', {
  description: 'The boxes of the props the cast’s ways go round, as a step last found them (WP 13.21).',
  fields: {
    blocks: { type: 'array', items: { type: 'number' }, default: [], description: 'Each box’s min, then max (m).' }, // prettier-ignore
    version: { type: 'integer', default: 0, minimum: 0, description: 'How many times the ways were made again.' },
  },
});

/** A world's navigation, the remake it is and the step it was made in, and its fields by key with the node each leads to. */ // prettier-ignore
interface Ways {
  readonly nav: SiteNav;
  readonly version: number;
  readonly tick: number;
  readonly fields: Map<unknown, { node: number; field: Float64Array }>;
}
type Kept = { siteWays: { blocks: number[]; version: number } };
const WAYS = new WeakMap<object, Ways>();
let plain: SiteNav | undefined;

/** How far up a walker of the cast steps between tiles (m): a kerb, a porch's step. */
const CLIMB = 0.4;

/** The site's navigation without a scene's props, made once (a pure function of the site): for placing in a setup. */
export function plainWays(): SiteNav {
  return (plain ??= createSiteNav(SITE, { climb: CLIMB }));
}

/** The navigation round `blocks`, remake `version`, as `w`'s ways. */
function made(w: World, blocks: readonly NavBlock[], version: number): SiteNav {
  const nav = createSiteNav(SITE, { climb: CLIMB, blocked: blocks });
  WAYS.set(w, { nav, version, tick: w.tick, fields: new Map() });
  return nav;
}

/** `w`'s navigation of the block round its props (see the file comment). */
export function waysOf<C extends object>(world: World<C>): SiteNav {
  const w = world as unknown as World;
  const [cached, kept] = [WAYS.get(w), (w.query('siteWays') as unknown as Kept[])[0]?.siteWays];
  if (cached && (kept ? kept.version === cached.version : cached.version === 0 && cached.tick === w.tick)) return cached.nav; // prettier-ignore
  if (!kept) {
    const blocks = propObstacles(w);
    w.spawn({ siteWays: { blocks: blocks.flatMap((b) => [...b.min, ...b.max]), version: 0 } });
    return made(w, blocks, 0);
  }
  const blocks: NavBlock[] = [];
  for (let i = 0; i < kept.blocks.length; i += 6) blocks.push({ min: [kept.blocks[i], kept.blocks[i + 1], kept.blocks[i + 2]], max: [kept.blocks[i + 3], kept.blocks[i + 4], kept.blocks[i + 5]] }); // prettier-ignore
  return made(w, blocks, kept.version);
}

/** Makes `w`'s ways again round its props as they stand now (a walker held by what its way does not know). */
export function replanWays<C extends object>(world: World<C>): void {
  const w = world as unknown as World;
  const kept = (w.query('siteWays') as unknown as Kept[])[0]?.siteWays;
  if (!kept) return void waysOf(w); // made this step already, as they stand
  const blocks = propObstacles(w);
  [kept.blocks, kept.version] = [blocks.flatMap((b) => [...b.min, ...b.max]), kept.version + 1];
  made(w, blocks, kept.version);
}

/** The flow field to `goal` kept under `key` (see the file comment), and the navigation it runs over. */
export function wayTo<C extends object>(
  w: World<C>,
  key: unknown,
  goal: readonly [number, number, number],
): { nav: SiteNav; field: Float64Array } {
  // prettier-ignore
  const nav = waysOf(w);
  const fields = WAYS.get(w)!.fields;
  const node = nav.nodeAt(goal[0], goal[1], goal[2]);
  let kept = fields.get(key);
  if (!kept || kept.node !== node)
    fields.set(key, (kept = { node, field: nav.flowField([goal[0], goal[1], goal[2]], { lazy: true }) }));
  return { nav, field: kept.field };
}
