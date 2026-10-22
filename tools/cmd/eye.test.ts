/**
 * @file Tests for `x eye` (tools/cmd/eye.ts, PLAN.md WP 12.3): the box's hero room seen headless from its own camera
 * and from another, at the eye's raster and finer, the picture printed shrunk with its legend in at most 20 lines, the
 * player kept, the whole answer beside the report; a small thing named by its cells, and the summary naming six things
 * at most; a scene without physics, a bad camera code or no scene is a usage error naming the fix.
 * @see tools/cmd/eye.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT_MS, dispatch, ROOT } from '../x';
import { seenText, SUMMARY_THINGS, thingText } from './eye';

/** Runs `node x eye …` in this repository; resolves to the exit code and printed lines. */
async function eye(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await dispatch(['eye', ...args], { print: (line) => lines.push(line) });
  return { code, lines };
}

describe('x eye', () => {
  it(
    'draws what the camera sees of the box’s hero room, with its legend, and writes the whole answer',
    { timeout: CHILD_TIMEOUT_MS },
    async () => {
      const { code, lines } = await eye('labs/box/scenes/room-hero');
      expect(lines[0]).toMatch(/^x eye: ok: box:room-hero from cam=iso: the level \d+%, the player \(\d+ cells?\) in 5184 cells$/); // prettier-ignore
      expect([code, lines.length <= 20]).toEqual([0, true]);
      expect(lines).toContain('legend: # the level: a wall, . the level: a floor, @ the player');
      const json = JSON.parse(readFileSync(join(ROOT, 'out/eye/box-room-hero/eye.json'), 'utf8'));
      expect([json.camera, json.cols, json.rows, json.map.length]).toEqual(['cam=iso', 96, 54, 54]); // the whole picture
      const top = await eye('box:room-hero', '--cam', 'cam=topdown', '--cols', '192', '--rows', '108');
      expect([top.code, top.lines[0]]).toEqual([0, expect.stringMatching(/from cam=topdown: .*the player \(\d+ cells\) in 20736 cells$/)]); // prettier-ignore
      const picture = top.lines.filter((line) => !/^(x eye|legend|report):/.test(line));
      expect([
        picture.length <= 16,
        picture.every((line) => line.length <= 56),
        picture.some((line) => line.includes('@')),
      ]).toEqual([true, true, true]); // shrunk, the player kept // prettier-ignore
    },
  );

  it('names a small thing by its cells, a big one by its share, and the first few things only', () => {
    const thing = { key: 'entity:4', kind: 'crate', entity: 4, cells: 1, share: 1 / 896 };
    expect([thingText(thing), thingText({ ...thing, cells: 90, share: 0.1 })]).toEqual(['crate #4 (1 cell)', 'crate #4 10%']); // prettier-ignore
    const many = Array.from({ length: SUMMARY_THINGS + 2 }, (_, i) => ({ ...thing, key: `entity:${i}`, entity: i }));
    expect([seenText(many).endsWith('crate #5 (1 cell), 2 more (eye.json)'), seenText([])]).toEqual([true, 'nothing']);
  });

  it(
    'refuses a scene without physics, a bad camera code and no scene, naming the fix',
    { timeout: CHILD_TIMEOUT_MS },
    async () => {
      const still = await eye('box:room');
      expect([still.code, still.lines.join('\n')]).toEqual([2, expect.stringContaining('has no physics: the eye casts at bodies')]); // prettier-ignore
      const bad = await eye('box:room-hero', '--cam', 'cam=nowhere');
      expect(bad.code).toBe(2);
      expect((await eye()).code).toBe(2);
    },
  );
});
