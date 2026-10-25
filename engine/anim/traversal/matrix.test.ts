/**
 * @file Unit tests for the traversal and holding states of the state matrix (engine/anim/traversal/matrix.ts, PLAN.md
 * WP 13.11): every state runs on the adult at both facings, its hands held on their contacts within §5.1's 3 cm
 * whenever they hold one (each state that holds something holds it), the aimed gun's muzzle within §5.1's 2° of the
 * aim, the slide-jump flown, and the same run twice gives the same poses.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { Animator } from '../character';
import { jointRotation, socketPosition } from '../fk';
import { FootPlant } from '../footPlant';
import { hashRun, stateMatrix } from '../stateMatrix';
import type { HoldPlant } from './hold';
import { TRAVERSAL_STATES } from './matrix';
import type { TraversalPlant } from './plant';

/** The adult with its feet planted, as the anim QA makes it (tools/qa/anim.ts `makeHumanoid`). */
const adult = (dt: number) => {
  const animator = new Animator({ build: 'build:adult', clock: 1, dt });
  new FootPlant().attach(animator);
  return animator;
};

/** Every traversal state's run at each facing and its poses' hash, as measured on 2026-10-25 (WP 12.2). */
const TRAVERSAL_HASHES: string[] = [
  'traversal:grab@0:692556480dcb2aaa',
  'traversal:grab@2.2:cfbff6d74a76e114',
  'traversal:hang@0:10d13cf11852654f',
  'traversal:hang@2.2:1adee12a076f66ff',
  'traversal:vault@0:45fccb7db3ccb8b7',
  'traversal:vault@2.2:56e63c3cc2a3d5b5',
  'traversal:climb@0:d3970c1f5ff5311b',
  'traversal:climb@2.2:8fee223d9ebb4475',
  'traversal:ladder@0:da08071101209ba3',
  'traversal:ladder@2.2:cb542a5fed222cfe',
  'traversal:zipline@0:c4d7b0948662f05d',
  'traversal:zipline@2.2:dd0b92ffc23e1ea5',
  'traversal:skydive@0:15634f77e21ceaed',
  'traversal:skydive@2.2:322060c5cfac513a',
  'traversal:slideJump@0:54f9a3701210ad15',
  'traversal:slideJump@2.2:500e9249a8ec1371',
  'hold:aim@0:486691b03618e881',
  'hold:aim@2.2:cab415b52d2cca40',
  'hold:sprint@0:fc93475c0c4a9504',
  'hold:sprint@2.2:d05d64461ae5d44e',
];

describe('the traversal states', () => {
  it('hold every contact within 3 cm, at both facings, and each state that holds something holds it', () => {
    const holding = ['traversal:grab', 'traversal:hang', 'traversal:vault', 'traversal:climb', 'traversal:ladder', 'traversal:zipline']; // prettier-ignore
    for (const id of Object.keys(TRAVERSAL_STATES)) {
      let [worst, held] = [0, 0];
      stateMatrix(adult, {
        states: { [id]: TRAVERSAL_STATES[id] },
        onStep: (animator) => {
          const plant = animator.layer('traversal') as TraversalPlant | undefined;
          const { skeleton, world } = animator.body;
          for (const [k, socket] of [
            [0, 'weaponL'],
            [1, 'weaponR'],
          ] as const) {
            const limb = plant?.limbs[k];
            if (!limb?.held) continue;
            [worst, held] = [Math.max(worst, socketPosition(skeleton, world, socket).distanceTo(limb.point)), held + 1];
          }
        },
      });
      expect(worst, id).toBeLessThan(0.03);
      if (holding.includes(id)) expect(held, id).toBeGreaterThanOrEqual(4); // two frames a facing at least: a vault's plant is quick
    }
  });

  it('points the aimed gun’s muzzle within 2° of the aim', () => {
    let [worst, aimed] = [0, 0];
    stateMatrix(adult, {
      states: { 'hold:aim': TRAVERSAL_STATES['hold:aim'] },
      onStep: (animator) => {
        const hold = animator.layer('hold') as HoldPlant | undefined;
        const look = hold?.look;
        if (!look || look.raised < 1 || look.weight < 1 || hold!.busy > 0) return;
        const yaw = animator.body.yaw + Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(look.yaw - animator.body.yaw), Math.cos(look.yaw - animator.body.yaw)))); // prettier-ignore
        const aim = new Vector3(Math.sin(yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(yaw) * Math.cos(look.pitch)); // prettier-ignore
        const muzzle = new Vector3(0, 0, 1).applyQuaternion(jointRotation(animator.body.world, 'handR'));
        [worst, aimed] = [Math.max(worst, muzzle.angleTo(aim)), aimed + 1];
      },
    });
    expect(aimed).toBeGreaterThan(100);
    expect(worst).toBeLessThan((2 * Math.PI) / 180);
  });

  it('flies the slide-jump with its legs and arms out, from a slide straight into the air', () => {
    let flown = 0;
    stateMatrix(adult, {
      states: { 'traversal:slideJump': TRAVERSAL_STATES['traversal:slideJump'] },
      onStep: (animator) => {
        flown = Math.max(
          flown,
          (animator.layer('traversal') as TraversalPlant | undefined)?.pose?.weights.slideJump ?? 0,
        );
      },
    });
    expect(flown).toBeGreaterThan(0.99);
  });

  it('poses as it was measured: each state’s run at each facing hashes as it did', () => {
    // characterization (WP 12.2): the poses of every traversal state, so that a change to a state's script or to how a
    // traversal poses the body shows here; a change meant to pose otherwise measures them again (PRINT_TRAVERSAL=1
    // prints them), its reason in its commit
    const runs = stateMatrix(adult, { states: TRAVERSAL_STATES }).map((run) => `${run.state}@${run.facing}:${hashRun(run)}`); // prettier-ignore
    if (process.env.PRINT_TRAVERSAL) console.log(JSON.stringify(runs));
    expect(runs).toEqual(TRAVERSAL_HASHES);
  });

  it('gives the same poses run twice', () => {
    const states = { 'traversal:grab': TRAVERSAL_STATES['traversal:grab'], 'traversal:ladder': TRAVERSAL_STATES['traversal:ladder'] }; // prettier-ignore
    const [a, b] = [stateMatrix(adult, { states }), stateMatrix(adult, { states })];
    expect(a.map(hashRun)).toEqual(b.map(hashRun));
  });
});
