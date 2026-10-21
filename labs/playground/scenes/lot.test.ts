/**
 * @file Unit tests for the lot (labs/playground/scenes/lot.ts, levels/lot.ts; PLAN.md WP 13.15): the house and the shed
 * stand where the site puts them, clean, the ground cut under the house's cellar; the bot (engine/dev/bot.ts) reaches every
 * room of the house from the yard and back, crouching where the attic's roof comes down; and over its tour of them all
 * no camera stands inside a wall (the soak: a course of the tour's own intents, judged by that bound of every camera's,
 * labs/playground/courses/bounds.ts, the others watched for WP 13.18's house).
 * @see labs/playground/scenes/lot.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../../fixtures/levels/storeys/glyphs';
import { createRegistry } from '../../../engine/core/registry';
import { defineCourse, runCourse } from '../../../engine';
import { createSession } from '../../../engine/sim/session';
import { runBot, type BotRun } from '../../../engine/dev/bot';
import { siteStructureAt, toWorld, validateLevel } from '../../../engine/sim-api';
import { cameraBounds } from '../courses/bounds';
import { LOT_HOUSE, LOT_ROOMS, LOT_SHED } from '../levels/lot';
import { LOT, LOT_START, lot } from './lot';

const [house, shed] = LOT.structures;
/** The storey fixtures' glyphs: their room markers, to read the fixtures' maps with. */
const registry = createRegistry();
defineStoreyFixtureGlyphs(registry);

/** Each room of the house as a goal: its marker's tile centre on its floor, in the world. */
const ROOMS = house.level.rooms!.map((room) => {
  const [x, z] = toWorld(house, ...([room.position[0], room.position[2]] as const));
  return { name: room.name, x, y: room.position[1] + house.at[1], z };
});

describe('the lot', () => {
  it('stands the house at (10, 12) and the shed turned a quarter at (24, 6), the ground cut under the cellar', () => {
    expect([house.footprint, shed.footprint, shed.turn]).toEqual([[10, 12, 18, 18], [24, 3, 28, 6], 1]);
    expect(ROOMS.map((room) => room.name).sort()).toEqual(Object.values(LOT_ROOMS).sort());
    expect(LOT.cut?.some((cell) => cell === 1)).toBe(true);
    expect(siteStructureAt(LOT, 12, 0.5, 14)?.room?.name).toBe('hall');
    // The storey fixtures' house and shed, room markers aside (the engine's tests run on those), until WP 13.18.
    const markers = new Map((registry.list('glyph') as unknown as { char: string; room: string }[]).filter((g) => g.room).map((g) => [g.char, Object.entries(LOT_ROOMS).find(([, room]) => room === g.room)?.[0] ?? g.char])); // prettier-ignore
    const lotOf = (name: string) => readFileSync(join(import.meta.dirname, `../../../fixtures/levels/storeys/${name}.txt`), 'utf8').split('\n').map((line) => (line.includes(':') || line === '---' ? line : [...line].map((c) => markers.get(c) ?? c).join(''))); // prettier-ignore
    const lines = (text: string) => text.split('\n').filter((line) => !line.startsWith('description:'));
    expect([lines(LOT_HOUSE), lines(LOT_SHED)]).toEqual(
      [lotOf('house'), lotOf('shed')].map((text) => lines(text.join('\n'))),
    );
    // Both levels clean: doors the hull fits, headroom, flights within the slope, every room reachable.
    const file = 'labs/playground/levels/lot.ts';
    expect([validateLevel(LOT_HOUSE, { file }), validateLevel(LOT_SHED, { file })]).toEqual([[], []]);
  });

  for (const room of ROOMS) {
    it(`lets the bot reach the ${room.name} from the yard and back`, () => {
      const session = createSession(lot, { seed: 1 });
      const report = runBot(session, LOT, { to: [room], back: true, steps: 3600, climb: 0.5 });
      expect([report.status, report.reached]).toEqual(['arrived', 2]);
      expect(Math.hypot(report.at[0] - LOT_START[0], report.at[2] - LOT_START[2])).toBeLessThan(1);
    });
  }

  it('keeps every follow camera out of the walls and on the player over the bot’s tour of every room', () => {
    const session = createSession(lot, { seed: 1 });
    const steps: { move: unknown; b: unknown }[] = [];
    const run: BotRun = { world: session.world, step: (intents) => (steps.push({ move: null, b: null, ...(intents as object) }), session.step(intents)) }; // prettier-ignore
    const report = runBot(run, LOT, { to: ROOMS, back: true, steps: 9000, climb: 0.5 });
    expect([report.status, report.reached]).toEqual(['arrived', ROOMS.length + 1]);
    const inputs: [number, Record<string, unknown>][] = [];
    steps.forEach((step, i) => {
      const last = i > 0 ? steps[i - 1] : { move: null, b: null };
      const change = Object.fromEntries(Object.entries(step).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(last[key as keyof typeof last]))); // prettier-ignore
      if (Object.keys(change).length) inputs.push([i, change]);
    });
    // WP 13.15's bound is the one judged: no camera inside a wall. The rest are watched for WP 13.18's house, roomier.
    const measures = cameraBounds(2).map((m) => (m.metric === 'cameraInside' ? m : { ...m, watch: 'WP 13.18' }));
    const course = defineCourse('course:playground-lot-soak', { scene: lot.id, seed: 1, steps: steps.length, inputs, measures }); // prettier-ignore
    const result = runCourse(course);
    const inside = result.results.filter((r) => r.metric === 'cameraInside');
    expect([inside.length, inside.filter((r) => r.value !== 0).map((r) => r.name)]).toEqual([5, []]);
    expect(result.pass).toBe(true);
  });
});
