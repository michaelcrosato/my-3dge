/**
 * @file The acceptance of the eval task playground-weapon (evals/playground-weapon/prompt.md), run by `node x evals` in
 * the attempt's copy: `weapon:playground-smg` (labs/playground/weapons/guns.ts) has the R-99's numbers and its prop, a
 * gun of clean parts in the weapon's frame with no body; in a player's hands in a yard it empties its 18 rounds in a
 * second of the trigger held, its last bringing on the reload from empty, 2.45 s, then fires on; and the player of the
 * playground still carries the pistol and the rifle.
 */
import { describe, expect, it } from 'vitest';
import { buildPropPart, getProp, inspectGeometry, partMatrix } from '../../engine';
import { addWeapons, createCharacter, defineScene, getWeapon, physicsOf, spawnActor, weaponsFor, type WeaponsState } from '../../engine/sim-api'; // prettier-ignore
import { createSession } from '../../engine/sim/session';
import { PLAYGROUND_WEAPONS } from '../../labs/playground/weapons/guns';

const smg = getWeapon('weapon:playground-smg');

/** A yard: a floor, and a player holding the submachine gun drawn. */
const yard = defineScene('eval-smg:yard', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnActor(w, { at: [0, 0, 0], character: createCharacter({ movement: 'movement:apex' }), player: true, components: { weapons: weaponsFor([smg.id], 0) } }); // prettier-ignore
    addWeapons(w);
  },
});

describe('weapon:playground-smg', () => {
  it('has the R-99’s numbers', () => {
    expect([smg.rate, smg.auto, smg.damage, smg.range, smg.magazine]).toEqual([18, true, 11, 60, 18]);
    expect([smg.reload.tactical, smg.reload.empty]).toEqual([1.8, 2.45]);
    expect([smg.spread.hip, smg.spread.move, smg.spread.ads]).toEqual([1.6, 0.6, 0.15]);
    expect([smg.zoom, smg.sights, smg.draw, smg.sound]).toEqual([63, 0.18, 0.25, 'sfx:rifleShot']);
    expect(Math.abs(smg.recoil[0][0] - 0.35)).toBeLessThan(0.1);
    expect(smg.recoil.length).toBeGreaterThan(1); // a pattern that climbs
  });

  it('is drawn as its prop: clean parts in the weapon’s frame, about 0.6 m long, with no body', () => {
    const prop = getProp('prop:playground-smg');
    expect([smg.prop, prop.body.type]).toEqual(['prop:playground-smg', 'none']);
    let [back, front, low] = [0, 0, 0];
    for (const part of prop.parts) {
      const report = inspectGeometry(buildPropPart(part).applyMatrix4(partMatrix(part)));
      expect([report.missing, report.degenerate, report.flipped, report.badNormals], part.name).toEqual([[], 0, 0, 0]);
      [back, front, low] = [
        Math.min(back, report.min[2]),
        Math.max(front, report.max[2]),
        Math.min(low, report.min[1]),
      ];
    }
    expect([front > 0.2, low < -0.05, Math.abs(front - back - 0.6) < 0.15]).toEqual([true, true, true]);
  });

  it('empties its 18 rounds in a second of the trigger held, reloads 2.45 s from empty, then fires on', () => {
    const session = createSession(yard, { seed: 1 });
    const weapons = () => (session.world.get(1) as unknown as { weapons: WeaponsState }).weapons;
    for (let k = 0; k < 66; k++) session.step({ b: ['fire'], ...(k === 0 ? { p: ['fire'] } : {}) });
    expect([weapons().shots, weapons().mags[0], weapons().reload >= 0]).toEqual([18, 0, true]);
    for (let k = 0; k < 150; k++) session.step({ b: ['fire'] });
    expect(weapons().shots).toBeGreaterThan(18);
    expect(weapons().shots).toBeLessThan(24);
  });

  it('is carried by nobody yet: the player keeps the pistol and the rifle', () => {
    expect(PLAYGROUND_WEAPONS).toEqual(['weapon:playground-pistol', 'weapon:playground-rifle']);
  });
});
