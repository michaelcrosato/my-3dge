/**
 * @file Unit tests for the hall's floor (labs/box/looks/hall-floor.ts, PLAN.md WP 7.8): the bake covers the whole hall
 * at 16 texels a metre and glows only in the dais's rune circle; the material draws it, glowing; and a view of the
 * hall registered with `HALL_MATERIALS`, as the page registers it, draws its floor, its galleries' walks and the dais's
 * top with the bake, while the walls, stairs and the dais's edge keep the engine's materials.
 * @see labs/box/looks/hall-floor.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bakeTexture, createHeadless, defineLevel, defineScene, getMaterial } from '../../../engine';
import { HALL_LEVEL } from '../scenes/hall';
import { HALL_FLOOR, HALL_FLOOR_TEXTURE, HALL_MATERIALS } from './hall-floor';

describe("the hall's floor", () => {
  it('bakes the whole hall at 16 texels a metre, glowing only in the rune circle on the dais', () => {
    const bake = bakeTexture(HALL_FLOOR_TEXTURE);
    expect([bake.width, bake.height]).toEqual([64 * 16, 44 * 16]);
    const dais = HALL_LEVEL.tiles.flatMap((glyph, i) =>
      HALL_LEVEL.legend[glyph].id === 'glyph:dais' ? [[i % HALL_LEVEL.cols, Math.floor(i / HALL_LEVEL.cols)]] : [],
    );
    const centre = [0, 1].map((k) => (Math.min(...dais.map((t) => t[k])) + Math.max(...dais.map((t) => t[k])) + 1) / 2);
    let glowing = 0;
    let farthest = 0;
    const emissive = bake.emissiveMap!;
    for (let y = 0; y < bake.height; y++) {
      for (let x = 0; x < bake.width; x++) {
        const at = (y * bake.width + x) * 4;
        if (emissive[at] + emissive[at + 1] + emissive[at + 2] === 0) continue;
        glowing++;
        const [mx, mz] = [(x + 0.5) / 16, (bake.height - y - 0.5) / 16]; // row 0 at the bottom, north up
        farthest = Math.max(farthest, Math.hypot(mx - centre[0], mz - centre[1]));
      }
    }
    expect(glowing).toBeGreaterThan(500);
    expect(farthest).toBeLessThan(3.5); // the outer ring, 3.375 m out
  });

  it('draws the bake, glowing, wherever the hall names the flagstones', async () => {
    expect(HALL_MATERIALS).toEqual({ 'material:flagstone': HALL_FLOOR });
    expect(getMaterial(HALL_FLOOR)).toMatchObject({ map: HALL_FLOOR_TEXTURE, emissive: '#ffffff' });
    const file = 'labs/box/levels/hall.txt';
    defineLevel('level:hallFloor', { text: readFileSync(file, 'utf8'), file, materials: HALL_MATERIALS });
    defineScene('box:hall-floor', { level: 'level:hallFloor', setup: () => {} });
    const engine = await createHeadless({ scene: 'box:hall-floor', view: true });
    const dump = (engine.scene as { dump(options: object): string }).dump({ filter: 'level:hallFloor/' });
    const material = (recipe: string) =>
      dump
        .split('\n')
        .filter((line) => line.includes(`level:hallFloor/${recipe}`))
        .map((line) => / (material:\w+)/.exec(line)?.[1]);
    expect(material('floor')).toEqual([HALL_FLOOR]);
    expect(material('gallery').every((m) => m === 'material:brick')).toBe(true); // a group's first: its sides
    expect(dump).toContain(HALL_FLOOR); // the galleries' walks and the dais's top, in their second groups
    expect(material('stairs').every((m) => m === 'material:stone')).toBe(true);
  });
});
