/**
 * @file Unit tests for the procedural rigs' contract (engine/anim/proc/rig.ts, PLAN.md WP 10.1): a run holding a state
 * between rests; a sound rig passing the check; each of the check's findings on a rig made to break it: a point not
 * finite, one under the floor, a bone stretching or off the length it gives, module state giving another run, and
 * motion that counts steps instead of seconds; a rig naming points or states it lacks, or giving points without
 * names, refused (`ANIM_BAD_RIG`); and its closure by state.
 * @see engine/anim/proc/rig.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { STATE_MATRIX } from '../stateMatrix';
import { driveRig, rigCheck, rigClosed, type ProcRig } from './rig';

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
    const short = post(() => new Vector3(0, 1, 0)); // its bone 1 m long, not the 1.2 m it gives
    expect(checks({ ...short, bones: [['foot', 'top', 1.2]] })).toEqual(['length']);
  });

  it('refuses a rig naming what it lacks or giving points without names, and closes its points by state', () => {
    const sound = post(() => new Vector3(0, 1, 0));
    expect(() => rigCheck({ ...sound, bones: [['foot', 'tip']] })).toThrow(/rig:post names "tip" in its bones or feet, not one of its points \(did you mean "top"\?\)/); // prettier-ignore
    expect(() => rigCheck({ ...sound, feet: ['toe'] })).toThrow(/names "toe" in its bones or feet/);
    expect(() => rigCheck({ ...sound, closed: { swing: 1 } })).toThrow(/closes "swing", not one of its states/);
    expect(() => driveRig(sound, 'swat', 0, 1 / 60)).toThrow(/has no state "swat" \(did you mean "sway"\?\)/);
    const short: ProcRig = { ...sound, make: () => ({ step: () => new Vector3(), points: () => [new Vector3()] }) };
    expect(() => rigCheck(short)).toThrow(/has points\(\) give 1 for its 2 names/);
    expect(() => rigCheck({ ...sound, closed: 3 })).toThrow(/closes 3 points, not a whole number from 0 to its 2/);
    expect(() => rigCheck({ ...sound, bones: [['foot', 'top', Number.NaN]] })).toThrow(/the length NaN, not a finite length/); // prettier-ignore
    expect(() => rigCheck({ ...sound, states: { sway: Infinity } })).toThrow(/holds its state "sway" Infinity s/);
    expect([rigClosed(sound, 'sway'), rigClosed({ ...sound, closed: 1 }, 'sway'), rigClosed({ ...sound, closed: { sway: 0 } }, 'sway')]).toEqual([2, 1, 0]); // prettier-ignore
  });
});
