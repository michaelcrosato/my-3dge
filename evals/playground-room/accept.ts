/**
 * @file The acceptance of the eval task playground-room (evals/playground-room/prompt.md), run by `node x evals` in the
 * attempt's copy: `level:cabin` (labs/playground/levels/cabin.ts) compiles to one storey 7 × 4 m, 2.6 m clear under a
 * flat roof, with the rooms `room:cabin` (4 × 3 m) and `room:bunks` (1.5 × 3 m, east of it), a door between them, a
 * door in from the south and a window in the west wall, and validates clean.
 */
import { describe, expect, it } from 'vitest';
import { getLevel, roomAt, validateLevel } from '../../engine';
import { registry } from '../../engine/core/registry';
import '../../labs/playground/levels/cabin';

const cabin = getLevel('level:cabin');
const room = (id: string) => cabin.rooms?.find((each) => each.id === id);
const index = (id: string) => cabin.rooms?.findIndex((each) => each.id === id) ?? -1;

describe('level:cabin', () => {
  it('is 7 × 4 m on 0.5 m tiles: one storey 2.6 m clear under a flat roof', () => {
    expect([cabin.tile, cabin.cols * cabin.tile, cabin.rows * cabin.tile]).toEqual([0.5, 7, 4]);
    expect(cabin.storeys?.map((storey) => storey.height)).toEqual([2.6]);
    expect(cabin.roofs?.map((roof) => roof.kind)).toEqual(['flat']);
  });

  it('has its main room, 4 × 3 m, and the bunk room, 1.5 × 3 m, east of it', () => {
    expect(cabin.rooms?.map((each) => each.id).sort()).toEqual(['room:bunks', 'room:cabin']);
    expect(Math.abs(room('room:cabin')!.area - 12)).toBeLessThan(0.6);
    expect(Math.abs(room('room:bunks')!.area - 4.5)).toBeLessThan(0.6);
    expect(roomAt(cabin, 2.5, 0, 2)?.id).toBe('room:cabin');
    expect(roomAt(cabin, 5.75, 0, 2)?.id).toBe('room:bunks');
  });

  it('joins them by a door, with a door in from the south and a window in the west wall', () => {
    const [main, bunks] = [index('room:cabin'), index('room:bunks')];
    const openings = cabin.openings ?? [];
    const between = openings.filter((o) => o.kind === 'door' && [...o.rooms].sort().join() === [main, bunks].sort().join()); // prettier-ignore
    const inside = openings.filter((o) => o.kind === 'door' && o.rooms.includes(main) && o.rooms.includes(-1));
    const windows = openings.filter((o) => o.kind === 'window' && o.rooms.includes(main) && o.rooms.includes(-1));
    expect([between.length, inside.length, windows.length]).toEqual([1, 1, 1]);
    for (const door of [...between, ...inside]) expect(door.width).toBeGreaterThanOrEqual(0.99);
    expect(inside[0].center[2]).toBeGreaterThan(3.4); // the south wall
    expect(windows[0].center[0]).toBeLessThan(0.6); // the west wall
  });

  it('validates clean: every room reachable, its doors wide enough, headroom where the player stands', () => {
    const entry = registry.get('level', 'level:cabin') as unknown as { text: string; file: string };
    expect(validateLevel(entry.text, { file: entry.file || 'level:cabin' })).toEqual([]);
  });
});
