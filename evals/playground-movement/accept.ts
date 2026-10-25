/**
 * @file The acceptance of the eval task playground-movement (evals/playground-movement/prompt.md), run by
 * `node x evals` in the attempt's copy: `movement:heavy` keeps Apex's hull and gravity with its own run, sprint and
 * jump, and in `playground:gym-heavy` (labs/playground/scenes/gym-heavy.ts) the empty-handed player runs at 3.6 × 1.15
 * m/s, sprints at 5.4 × 1.15 and jumps 1.0 m, while the gym's Apex player keeps his run (the gym's replays are the
 * task's commands).
 */
import { describe, expect, it } from 'vitest';
import { createHeadless, getMovement } from '../../engine';
import '../../labs/playground/scenes/gym';
import '../../labs/playground/scenes/gym-heavy';

/** The player's steady speed west over the open floor (the second second of the run), sprinting when asked. */
async function speed(scene: string, sprint: boolean): Promise<number> {
  const engine = await createHeadless({ scene });
  const x = () => (engine.state('actor').entities as unknown as { actor: { x: number } }[])[0].actor.x;
  const b = sprint ? ['sprint'] : [];
  engine.step(1, { move: [-1, 0], b, p: b });
  engine.step(59, { move: [-1, 0], b });
  const from = x();
  engine.step(60, { move: [-1, 0], b });
  return from - x();
}

describe('the heavy soldier', () => {
  it('keeps movement:apex’s hull, steps, slopes and gravity, with his own run and sprint', () => {
    const [heavy, apex] = [getMovement('movement:heavy'), getMovement('movement:apex')];
    for (const key of ['capsule', 'autostep', 'maxSlope', 'characterGravity'])
      expect(heavy.character[key], key).toEqual(apex.character[key]);
    expect([heavy.model?.gaits.run, heavy.model?.gaits.sprint, heavy.model?.gaits.holstered]).toEqual([3.6, 5.4, 1.15]); // prettier-ignore
    expect(heavy.model?.accel).toEqual(apex.model?.accel);
  });

  it('runs at 3.6 × 1.15 m/s and sprints at 5.4 × 1.15 m/s empty-handed in playground:gym-heavy', async () => {
    expect(Math.abs((await speed('playground:gym-heavy', false)) - 3.6 * 1.15)).toBeLessThan(0.15);
    expect(Math.abs((await speed('playground:gym-heavy', true)) - 5.4 * 1.15)).toBeLessThan(0.2);
  }, 300_000);

  it('jumps 1.0 m in playground:gym-heavy', async () => {
    const engine = await createHeadless({ scene: 'playground:gym-heavy' });
    let top = 0;
    for (let k = 0; k < 60; k++) {
      engine.step(1, { b: ['jump'], ...(k === 0 ? { p: ['jump'] } : {}) });
      top = Math.max(top, (engine.state('actor').entities as unknown as { actor: { y: number } }[])[0].actor.y);
    }
    expect(Math.abs(top - 1)).toBeLessThan(0.05);
  }, 300_000);

  it('leaves the gym’s own player as he was: Apex’s run, empty-handed', async () => {
    expect(Math.abs((await speed('playground:gym', false)) - 4.4069 * 1.15)).toBeLessThan(0.15);
  }, 300_000);
});
