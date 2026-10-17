/**
 * @file Unit tests for the gym (labs/playground/levels/gym.ts and labs/playground/scenes/gym.ts): every feature's
 * number is the height, slope or gap the compiled level holds where its sign says; no two features overlap and each
 * stays inside the perimeter; the player stands at the spawn at the north end; and the settings change play: a faster
 * run covers more ground, a higher jump rises higher, as Apex's numbers set them by default.
 * @see labs/playground/scenes/gym.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { floorHeight, topHeight } from '../../../engine/sim-api';
import { APEX_JUMP, APEX_RUN, playerCharacter } from '../cast/player';
import { GYM_FEATURES, GYM_SPAWN, GYM_TILE, type GymFeature, type GymRect } from '../levels/gym';
import { GYM, GYM_START, gym } from './gym';

/** A rectangle's centre (m). */
const centre = (rect: GymRect): [number, number] => [rect.x + rect.w / 2, rect.z + rect.d / 2];

/** The features of `kind`. */
const of = (kind: GymFeature['kind']) => GYM_FEATURES.filter((feature) => feature.kind === kind);

/** The player's feet after `steps` steps from the spawn, holding `move`, and jumping at the start when asked. */
async function after(steps: number, intents: { move?: [number, number]; jump?: boolean }, settings = {}) {
  const engine = await createHeadless({ scene: gym, settings });
  const move = intents.move ?? [0, 0];
  let top = 0;
  for (let k = 0; k < steps; k++) {
    // a jump held to its apex: letting go early cuts it (the controller's variable jump)
    engine.step(1, { move, ...(intents.jump && k < 40 ? { b: ['jump'], ...(k === 0 ? { p: ['jump'] } : {}) } : {}) });
    const [player] = engine.state('actor').entities as unknown as { actor: { x: number; y: number; z: number } }[];
    top = Math.max(top, player.actor.y);
  }
  const [player] = engine.state('actor').entities as unknown as { actor: { x: number; y: number; z: number } }[];
  return { ...player.actor, top };
}

describe('the gym', () => {
  it('holds each block at its number: mantle walls, fences, climb walls, the steps and the tower', () => {
    for (const kind of ['mantle', 'fence', 'climb', 'tower'] as const) {
      for (const feature of of(kind)) {
        const [x, z] = centre(feature.rects[0]);
        expect(topHeight(GYM, x, z), feature.id).toBeCloseTo(feature.value, 6);
      }
    }
    const [steps] = of('steps');
    steps.rects.forEach((rect, k) => expect(topHeight(GYM, ...centre(rect))).toBeCloseTo(0.25 * (k + 1), 6));
  });

  it('holds each slide ramp and slope test at its angle, with its deck at the top', () => {
    for (const feature of [...of('slide'), ...of('slope')]) {
      const [deck, ramp] = feature.rects;
      const length = ramp.d;
      const [x] = centre(ramp);
      const top = floorHeight(GYM, x, deck.z + deck.d / 2);
      const low = feature.kind === 'slide' ? ramp.z + ramp.d - GYM_TILE / 4 : ramp.z + GYM_TILE / 4;
      const high = feature.kind === 'slide' ? ramp.z + GYM_TILE / 4 : ramp.z + ramp.d - GYM_TILE / 4;
      const slope = (floorHeight(GYM, x, high) - floorHeight(GYM, x, low)) / (length - GYM_TILE / 2);
      expect(Math.atan(slope) * (180 / Math.PI), feature.id).toBeCloseTo(feature.value, 2);
      expect(top, feature.id).toBeCloseTo(length * Math.tan((feature.value * Math.PI) / 180), 2);
    }
  });

  it('spaces the gap lane’s platforms by each gap', () => {
    const lane = of('gap');
    for (let k = 1; k < lane.length; k++) {
      const [before] = lane[k - 1].rects;
      const [platform] = lane[k].rects;
      expect(platform.z - (before.z + before.d), lane[k].id).toBe(lane[k].value);
      expect(topHeight(GYM, ...centre(platform))).toBeCloseTo(1.5, 6);
    }
  });

  it('keeps every feature inside the perimeter, on whole tiles, none overlapping another', () => {
    const painted = new Map<string, number>();
    for (const { rects } of GYM_FEATURES) {
      for (const rect of rects) {
        for (const v of [rect.x, rect.z, rect.w, rect.d]) expect(Number.isInteger(v / GYM_TILE)).toBe(true);
        expect(rect.x).toBeGreaterThanOrEqual(GYM_TILE);
        expect(rect.z).toBeGreaterThanOrEqual(GYM_TILE);
        expect(rect.x + rect.w).toBeLessThanOrEqual(GYM.cols * GYM_TILE - GYM_TILE);
        expect(rect.z + rect.d).toBeLessThanOrEqual(GYM.rows * GYM_TILE - GYM_TILE);
        const area = (rect.w / GYM_TILE) * (rect.d / GYM_TILE);
        if (rect.char) painted.set(rect.char, (painted.get(rect.char) ?? 0) + area);
      }
    }
    for (const [char, area] of painted) expect(GYM.tiles.filter((tile) => tile === char).length, char).toBe(area);
  });

  it('stands the player at the spawn, on the floor at the gym’s north end', async () => {
    expect(GYM_START).toEqual(GYM_SPAWN);
    const feet = await after(60, {});
    expect(feet.x).toBeCloseTo(GYM_SPAWN[0], 4); // positions are float32 in the physics
    expect(feet.z).toBeCloseTo(GYM_SPAWN[2], 4);
    expect(feet.y).toBeCloseTo(0, 3);
  });

  it('runs at Apex’s holstered run and jumps Apex’s height by default; the settings change both', async () => {
    const holstered = APEX_RUN * playerCharacter().movement!.gaits.holstered; // empty-handed: 5.07 m/s
    const run = await after(60, { move: [-1, 0] }); // west along the open floor north of the features
    expect(GYM_SPAWN[0] - run.x).toBeGreaterThan(holstered * 0.8);
    expect(GYM_SPAWN[0] - run.x).toBeLessThan(holstered * 1.01);
    const faster = await after(60, { move: [-1, 0] }, { 'playground.gym.speed': 6 });
    expect(GYM_SPAWN[0] - faster.x).toBeGreaterThan(GYM_SPAWN[0] - run.x);
    const jump = await after(60, { jump: true });
    expect(jump.top).toBeCloseTo(APEX_JUMP, 1);
    const higher = await after(60, { jump: true }, { 'playground.gym.jump': 2 });
    expect(higher.top).toBeCloseTo(2, 1);
  });
});
