/**
 * @file Unit tests for an attack's trail and window (engine/anim/attack.ts, PLAN.md WP 6.1; the rest of its tests,
 * with the timeline's and the combo's, are engine/anim/timeline.test.ts): it trails from the strike into the first
 * share of the recover, never in the wind; it starts closed and empty, sweeps its first segment from itself, and a
 * cancel closes its window.
 * @see engine/anim/attack.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import { Attack } from './attack';

describe('Attack', () => {
  it('trails from the strike into the first share of the recover, never in the wind', () => {
    const slash = new Attack('slash');
    slash.start();
    const seen: [string | undefined, number, string | undefined][] = [];
    while (slash.busy) {
      seen.push([slash.phase, slash.u, slash.trail(true)]);
      slash.update(SIM_DT);
    }
    const trailing = (phase: string, test: (u: number) => boolean) => seen.filter(([p, u]) => p === phase && test(u)).map(([, , trail]) => trail); // prettier-ignore
    expect(new Set(trailing('wind', () => true))).toEqual(new Set([undefined]));
    expect(new Set(trailing('active', () => true))).toEqual(new Set(['blade']));
    expect(new Set(trailing('recover', (u) => u < 0.12))).toEqual(new Set(['blade'])); // TRAIL_AFTER
    expect(new Set(trailing('recover', (u) => u >= 0.12))).toEqual(new Set([undefined]));
    expect(trailing('recover', (u) => u < 0.12).length * trailing('recover', (u) => u >= 0.12).length).toBeGreaterThan(
      0,
    );
  });

  it('starts closed and empty, sweeps its first segment from itself, and closes its window when cancelled', () => {
    const slash = new Attack('slash');
    expect([slash.events, slash.save()]).toEqual([[], expect.objectContaining({ hit: [], segment: [], open: false })]);
    slash.start();
    while (!slash.hitOpen) slash.update(SIM_DT);
    const sweep = slash.sweep(new Vector3(1, 2, 3), new Vector3(4, 5, 6)); // the first segment it has seen
    expect([sweep?.base0.toArray(), sweep?.tip0.toArray()]).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    slash.update(SIM_DT);
    slash.cancel();
    expect([
      slash.rootDelta,
      slash.save().open,
      slash.hits(
        [{ id: 1 }],
        () => true,
        () => {},
      ),
    ]).toEqual([0, false, 0]);
  });
});
