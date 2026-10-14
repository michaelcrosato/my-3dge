/**
 * @file Unit tests for the crowd, Box 4 (labs/box/scenes/crowd-1000.ts and its presets crowd-100.ts and crowd-5000.ts,
 * PLAN.md WP 5.7): the queue lets 25 members in a step (1,000 are in after 40 steps); the mix is drawn as asked;
 * every member starts on an open tile of the hall's floor, nearly all at least 5 m from the hero; the presets differ
 * only in their count; and the Box 4 replays do what their descriptions say, to their goldens: in box-4-chase
 * (tests/replays/box-4-chase.replay.json) the hero walks off the dais, up the west stairs and along the west gallery,
 * and the crowd follows him up the stairs, walkers walking their rise and standing on the gallery, 1 m up, at the end
 * (Done-when 1); in box-4-hop a crowd of slimes hops up after him; in box-4-stairs, at 1,000, the hero waits at the
 * stairs' foot with the crowd round him and still climbs to the gallery, shoving it aside (the hero's `shoves`).
 * @see labs/box/scenes/crowd-1000.ts
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeadless, floorHeight, tileAt } from '../../../engine';
import { HALL_LEVEL, HALL_START } from './hall';
import { CROWD_TILES, crowd1000 } from './crowd-1000';
import { crowd100 } from './crowd-100';
import { crowd5000 } from './crowd-5000';

type Member = {
  crowdMember: { state: string; x: number; y: number; z: number; shape: string; flyer: boolean };
  crowdWalker?: object;
  crowdSlime?: object;
  crowdWisp?: object;
};
type Engine = Awaited<ReturnType<typeof createHeadless>>;

/** Every member of the crowd, in id order. */
const members = (engine: Engine) => engine.entities('crowdMember').map(({ id }) => engine.get(id) as unknown as Member);
/** A member's kind. */
const kind = (m: Member) => (m.crowdWalker ? 'walker' : m.crowdSlime ? 'slime' : m.crowdWisp ? 'wisp' : '?');
/** The glyph id of the tile under (x, z). */
function glyphAt(x: number, z: number): string {
  const { col, row } = tileAt(HALL_LEVEL, x, z)!;
  return HALL_LEVEL.legend[HALL_LEVEL.tiles[row * HALL_LEVEL.cols + col]].id;
}

/** The replay `name` (tests/replays/<name>.replay.json), its text and its final golden hash. */
const text = (name: string) => readFileSync(`tests/replays/${name}.replay.json`, 'utf8');
function goldenOf(name: string): string {
  const { steps, hashes } = JSON.parse(text(name)) as { steps: number; hashes: Record<string, Record<string, string>> };
  return hashes[`${process.platform}-${process.arch}`][steps];
}

/** The engine after `until` steps of the replay `name` (all of it by default), and its hash. */
async function play(name: string, until?: number) {
  const scene = (JSON.parse(text(name)) as { scene: string }).scene;
  const engine = await createHeadless({ scene: scene === crowd100.id ? crowd100 : crowd1000 });
  const replay = engine.replay as (text: string, options: { until?: number }) => Promise<{ hash: string }>;
  const run = await replay(text(name), { until });
  return { engine, hash: run.hash };
}

/** The members standing on a gallery, 1 m up. */
const onGallery = (engine: Engine) =>
  members(engine).filter(({ crowdMember: a }) => glyphAt(a.x, a.z) === 'glyph:gallery' && Math.abs(a.y - 1) < 0.02);

describe('the crowd', () => {
  it('queues every member at the start and lets 25 in a step: 1,000 after 40 steps, all alive', async () => {
    const engine = await createHeadless({ scene: crowd1000 });
    const alive = () => members(engine).filter((m) => m.crowdMember.state === 'alive').length;
    expect(members(engine)).toHaveLength(1000);
    const counts: number[] = [];
    for (let k = 0; k < 41; k++) {
      engine.step(1);
      counts.push(alive());
    }
    expect(counts.slice(0, 5)).toEqual([25, 50, 75, 100, 125]);
    expect(counts.slice(38)).toEqual([975, 1000, 1000]);
  });

  it('draws the mix: half walkers, three in ten slimes, two in ten wisps, or one kind alone', async () => {
    const census = async (mix: string) => {
      const engine = await createHeadless({ scene: crowd1000, settings: { 'box.crowd.mix': mix } });
      return members(engine).reduce<Record<string, number>>((n, m) => ({ ...n, [kind(m)]: (n[kind(m)] ?? 0) + 1 }), {});
    };
    const mixed = await census('mixed');
    expect(mixed.walker + mixed.slime + mixed.wisp).toBe(1000);
    expect(Math.abs(mixed.walker - 500)).toBeLessThan(50);
    expect(Math.abs(mixed.slime - 300)).toBeLessThan(45);
    expect(Math.abs(mixed.wisp - 200)).toBeLessThan(40);
    expect(await census('walkers')).toEqual({ walker: 1000 });
    expect(await census('slimes')).toEqual({ slime: 1000 });
    expect(await census('wisps')).toEqual({ wisp: 1000 });
    const engine = await createHeadless({ scene: crowd1000 });
    const shapes = new Set(members(engine).map((m) => `${kind(m)}:${m.crowdMember.shape}:${m.crowdMember.flyer}`));
    expect([...shapes].sort()).toEqual(['slime:ball:false', 'walker:capsule:false', 'wisp:ball:true']);
  });

  it('starts every member on an open tile of the hall’s floor, nearly all at least 5 m from the hero', async () => {
    const engine = await createHeadless({ scene: crowd1000 });
    const tiles = new Set(CROWD_TILES);
    const list = members(engine);
    for (const { crowdMember: a } of list) {
      const { col, row } = tileAt(HALL_LEVEL, a.x, a.z)!;
      expect(tiles.has(row * HALL_LEVEL.cols + col)).toBe(true);
      expect(a.y).toBe(floorHeight(HALL_LEVEL, a.x, a.z)); // the floor, or the foot of the dais's slope
      expect(a.y).toBeLessThan(0.5);
    }
    const near = list.filter(({ crowdMember: a }) => Math.hypot(a.x - HALL_START[0], a.z - HALL_START[2]) < 5);
    expect(near.length).toBeLessThan(5); // 40 draws each: only the unlucky stay near
  });

  it('has presets for 100 and 5,000, which differ only in their count; the count can be set', async () => {
    expect([crowd100.id, crowd1000.id, crowd5000.id]).toEqual(['box:crowd-100', 'box:crowd-1000', 'box:crowd-5000']);
    expect([crowd100, crowd1000, crowd5000].map((scene) => scene.settings)).toEqual([
      { 'box.crowd.count': 100 },
      { 'box.crowd.count': 1000 },
      { 'box.crowd.count': 5000 },
    ]);
    expect(members(await createHeadless({ scene: crowd100 }))).toHaveLength(100);
    expect(members(await createHeadless({ scene: crowd5000, settings: { 'box.crowd.count': 7 } }))).toHaveLength(7);
  });

  it('follows the hero up the west stairs in box-4-chase: walkers climb them and stand on the west gallery', async () => {
    const climbing = await play('box-4-chase', 600);
    const onStairs = members(climbing.engine).filter(
      ({ crowdMember: a }) => glyphAt(a.x, a.z) === 'glyph:stairs' && a.y > 0.2 && a.y < 0.9,
    );
    expect(onStairs.length).toBeGreaterThan(0); // on the way up, walking the stairs' rise
    const [end, again] = [await play('box-4-chase'), await play('box-4-chase')];
    expect(end.hash).toBe(goldenOf('box-4-chase'));
    expect(again.hash).toBe(end.hash);
    const hero = end.engine.get(1)?.actor as { x: number; y: number; z: number };
    expect(glyphAt(hero.x, hero.z)).toBe('glyph:gallery');
    const kinds = onGallery(end.engine).map(kind);
    expect(kinds.filter((k) => k === 'walker').length).toBeGreaterThanOrEqual(3); // Done-when 1: at least one
    expect(kinds).not.toContain('wisp'); // the flyers hover; those on it walked or hopped up the stairs
  }, 120_000);

  it('lets the hero through 1,000 in box-4-stairs: he waits 5 s at the stairs’ foot in the crowd, then climbs to the gallery', async () => {
    const waiting = await play('box-4-stairs', 620);
    const foot = waiting.engine.get(1)?.actor as { x: number; y: number; z: number };
    const round = members(waiting.engine).filter(({ crowdMember: a }) => Math.hypot(a.x - foot.x, a.z - foot.z) < 2);
    expect(round.length).toBeGreaterThanOrEqual(5); // the crowd presses in while he waits
    const end = await play('box-4-stairs');
    const hero = end.engine.get(1)?.actor as { x: number; y: number; z: number };
    expect(glyphAt(hero.x, hero.z)).toBe('glyph:gallery');
    expect(hero.y).toBeCloseTo(1, 1);
    expect(end.hash).toBe(goldenOf('box-4-stairs'));
  }, 180_000);

  it('hops up the west stairs after him in box-4-hop: slimes stand on the west gallery at the end', async () => {
    const end = await play('box-4-hop');
    expect(end.hash).toBe(goldenOf('box-4-hop'));
    expect(members(end.engine).every((m) => kind(m) === 'slime')).toBe(true);
    expect(onGallery(end.engine).length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
