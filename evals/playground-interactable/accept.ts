/**
 * @file The acceptance of the eval task playground-interactable (evals/playground-interactable/prompt.md), run by
 * `node x evals` in the attempt's copy: `addRadio` (labs/playground/cast/radio.ts) stands `prop:playground-radio`, a
 * small radio of clean parts, with the component `radio`; before a player it is what his use would use, the HUD
 * saying it turns it on; a use turns it on and the next off, each with the event `radio` `{ id, on }`, leaving another
 * radio as it is; and a run plays the same twice and continues exactly from a capture.
 */
import { describe, expect, it } from 'vitest';
import { buildPropPart, getProp, inspectGeometry, partMatrix } from '../../engine';
import { addInteraction, createCharacter, defineScene, physicsOf, spawnActor } from '../../engine/sim-api';
import { createSession } from '../../engine/sim/session';
import { addRadio } from '../../labs/playground/cast/radio';

/** A yard: a floor, a player at the origin facing +Z, a radio 1 m before him (2) and one playing behind him (3). */
const yard = defineScene('eval-radio:yard', {
  physics: true,
  setup(w) {
    physicsOf(w).addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] }); // prettier-ignore
    spawnActor(w, { at: [0, 0, 0], character: createCharacter({ movement: 'movement:apex' }), player: true });
    addRadio(w, { at: [0, 0, 1] });
    addRadio(w, { at: [0, 0, -4], yaw: Math.PI, on: true });
    addInteraction(w);
  },
});

type Entity = { interactor: { target: number; prompt: string }; radio: { on: boolean }; sceneProp: { prop: string } };

describe('the radio', () => {
  it('is a small radio of clean parts, about 0.3 × 0.2 × 0.15 m', () => {
    const prop = getProp('prop:playground-radio');
    const [min, max] = [
      [Infinity, Infinity, Infinity],
      [-Infinity, -Infinity, -Infinity],
    ];
    for (const part of prop.parts) {
      const report = inspectGeometry(buildPropPart(part).applyMatrix4(partMatrix(part)));
      expect([report.missing, report.degenerate, report.flipped, report.badNormals], part.name).toEqual([[], 0, 0, 0]);
      for (let k = 0; k < 3; k++) [min[k], max[k]] = [Math.min(min[k], report.min[k]), Math.max(max[k], report.max[k])];
    }
    const size = max.map((v, k) => v - min[k]);
    expect(Math.abs(size[1] - 0.2)).toBeLessThan(0.05);
    expect([Math.max(size[0], size[2]), Math.min(size[0], size[2])].map((v, k) => Math.abs(v - [0.3, 0.15][k]) < 0.05)).toEqual([true, true]); // prettier-ignore
  });

  it('is what the player’s use would use before it; a use turns it on, the next off, each with its event', () => {
    const session = createSession(yard, { seed: 1 });
    const get = (id: number) => session.world.get(id) as unknown as Entity;
    session.step({});
    session.step({});
    expect([get(2).sceneProp.prop, get(2).radio.on, get(3).radio.on]).toEqual(['prop:playground-radio', false, true]);
    expect([get(1).interactor.target, get(1).interactor.prompt]).toEqual([2, 'Turn the radio on']);
    session.step({ b: ['interact'] });
    session.step({});
    expect([get(2).radio.on, get(1).interactor.prompt]).toEqual([true, 'Turn the radio off']);
    session.step({ b: ['interact'] });
    session.step({});
    const said = session.world.events
      .trace()
      .filter((event) => event.type === 'radio')
      .map((event) => event.payload);
    expect([get(2).radio.on, get(3).radio.on, said]).toEqual([false, true, [{ id: 2, on: true }, { id: 2, on: false }]]); // prettier-ignore
  });

  it('plays the same twice, and continues exactly from a capture', () => {
    const run = (from = 0, session = createSession(yard, { seed: 1 })) => {
      const hashes: string[] = [];
      for (let i = from; i < 40; i++) hashes.push((session.step(i === 3 ? { b: ['interact'] } : {}), session.world.hash())); // prettier-ignore
      return hashes;
    };
    const whole = run();
    expect(run()).toEqual(whole);
    const half = createSession(yard, { seed: 1 });
    for (let i = 0; i < 10; i++) half.step(i === 3 ? { b: ['interact'] } : {});
    const fresh = createSession(yard, { seed: 1 });
    fresh.world.restore(half.world.capture());
    expect(run(10, fresh)).toEqual(whole.slice(10));
  });
});
