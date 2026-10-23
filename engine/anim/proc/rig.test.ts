/**
 * @file Unit tests for the procedural rigs' contract (engine/anim/proc/rig.ts, PLAN.md WP 10.1): a run holding a state
 * between rests; a sound rig passing the check; and each of the check's findings on a rig made to break it: a point
 * not finite, one under the floor, a bone stretching, module state giving another run, and motion that counts steps
 * instead of seconds.
 * @see engine/anim/proc/rig.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { STATE_MATRIX } from '../stateMatrix';
import { driveRig, rigCheck, type ProcRig } from './rig';

/** A post whose top sways as `top(t, dt, steps)` says, `t` seconds into its state. */
const post = (top: (t: number, dt: number, steps: number) => Vector3, bones = true): ProcRig => ({
  id: 'rig:post',
  names: ['foot', 'top'],
  bones: bones ? [['foot', 'top']] : [],
  states: { sway: 0.5 },
  make(_state, _facing, dt) {
    let [t, steps] = [0, 0];
    return {
      step: (time) => ((t = time ?? 0), steps++, new Vector3()),
      points: () => [new Vector3(), top(t, dt, steps)],
    };
  },
});

describe('the procedural rigs’ contract', () => {
  it('runs a state between rests, and passes a sound rig', () => {
    const sound = post((t) => new Vector3(Math.sin(t * 6) * 0.3, Math.cos(t * 6) * 0.3 + 1, 0).normalize());
    const run = driveRig(sound, 'sway', 0, 1 / 60);
    expect(run.held).toEqual([Math.round(STATE_MATRIX.lead * 60), Math.round(STATE_MATRIX.lead * 60) + 30]);
    expect(run.world.length).toBe(run.held[1] + Math.round(STATE_MATRIX.after * 60));
    expect(rigCheck(sound)).toMatchObject({ ok: true, problems: [] });
  });

  it('finds a point not finite, one under the floor, a bone stretching, another run, and steps counted for seconds', () => {
    const checks = (rig: ProcRig) => [...new Set(rigCheck(rig).problems.map((p) => p.check))];
    expect(checks(post((t) => new Vector3(0, t > 0.2 ? NaN : 1, 0)))).toEqual(['finite']);
    expect(checks(post((t) => new Vector3(0, 1 - 3 * t, 0), false))).toEqual(['floor']);
    expect(checks(post((t) => new Vector3(0, 1 + t, 0)))).toEqual(['length']);
    let leak = 0;
    expect(checks(post(() => new Vector3(0, 1, (leak += 1e-3)), false))).toContain('hash');
    expect(checks(post((_, __, steps) => new Vector3(Math.sin(steps / 10), 1, 0), false))).toEqual(['rate']);
    const [stretched] = rigCheck(post((t) => new Vector3(0, 1 + t, 0))).problems;
    expect(stretched.message).toMatch(
      /^rig:post, sway facing 0: frame \d+: the bone foot–top is [\d.]+ m off its length$/,
    );
  });
});
