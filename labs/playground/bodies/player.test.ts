/**
 * @file Unit tests for the player's body (labs/playground/bodies/player.ts) on `build:adult`, in Node: it compiles with
 * every part placed, wears every slot it names and names every slot it wears, gives each garment two tones and the
 * accent on the yoke, the pack's flap and the cuffs, stands 1.80 m tall, and draws as geometry the geo QA passes.
 * @see labs/playground/bodies/player.ts
 */
import { describe, expect, it } from 'vitest';
import { getBuild } from '../../../engine/anim/builds';
import { inspectGeometry } from '../../../engine/gfx/geometry/inspect';
import { compileBody } from '../../../engine/gfx/puppets/compile';
import { puppetGeometry } from '../../../engine/gfx/puppets/draw';
import { PLAYER, PLAYER_BODY } from './player';

/** The player's body compiled for the adult build. */
const compiled = compileBody(PLAYER, 'build:adult');

/** The slots the pieces wear, each once. */
const worn = [...new Set(compiled.pieces.map((piece) => piece.slot))].sort();

describe('body:player', () => {
  it('compiles on build:adult, wearing every slot it names and naming every slot it wears', () => {
    expect(compiled.pieces.length).toBeGreaterThan(30);
    expect(worn).toEqual(Object.keys(PLAYER_BODY.slots!).sort());
  });

  it("gives each garment two tones, and the accent on the yoke, the pack's flap and the cuffs", () => {
    for (const pair of [
      ['jacket', 'jacketDark'],
      ['pants', 'pantsDark'],
      ['boot', 'sole'],
      ['pack', 'accent'],
    ]) {
      expect(worn, pair.join(' and ')).toEqual(expect.arrayContaining(pair));
      expect(PLAYER_BODY.slots![pair[0]]).not.toBe(PLAYER_BODY.slots![pair[1]]);
    }
    const accents = compiled.pieces.filter((piece) => piece.slot === 'accent').map((piece) => piece.part);
    expect(accents.length).toBeGreaterThanOrEqual(4); // the yoke, the pack's flap, a cuff each side
  });

  it('stands 1.80 m tall on the adult build, its head on top', () => {
    const geometry = puppetGeometry(compiled);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    expect(min.y).toBeCloseTo(0, 1);
    expect(max.y).toBeGreaterThan(1.78);
    expect(max.y).toBeLessThan(1.84);
    const build = getBuild('build:adult');
    expect(build.hipHeight + build.torso + build.neck + 2 * build.headRadius).toBeCloseTo(1.8, 6);
  });

  it('draws as geometry the geo QA family passes: finite, no degenerate or flipped triangles, unit normals', () => {
    const report = inspectGeometry(puppetGeometry(compiled));
    expect([report.nonFinite, report.badIndex, report.degenerate, report.badNormals, report.flipped]).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});
