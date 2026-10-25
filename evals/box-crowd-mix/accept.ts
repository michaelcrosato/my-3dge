/**
 * @file The acceptance of the eval task box-crowd-mix (evals/box-crowd-mix/prompt.md), run by `node x evals` in the
 * attempt's copy: the mix `hunters` of `box.crowd.mix` queues six in ten walkers and four in ten wisps, no slimes;
 * `box:crowd-hunters` (labs/box/scenes/crowd-hunters.ts) is the crowd with 200 of them, the same run twice; and the
 * mix the crowd had queues exactly what it queued before (the replays' goldens are the task's commands).
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import '../../labs/box/scenes/crowd-1000';
import '../../labs/box/scenes/crowd-hunters';

type Engine = Awaited<ReturnType<typeof createHeadless>>;

/** How many of each kind the crowd queued: walkers, slimes and wisps. */
function census(engine: Engine): Record<string, number> {
  const counts: Record<string, number> = { walker: 0, slime: 0, wisp: 0 };
  for (const { id } of engine.entities('crowdMember')) {
    const member = engine.get(id) as Record<string, unknown>;
    const kind = member.crowdWalker ? 'walker' : member.crowdSlime ? 'slime' : member.crowdWisp ? 'wisp' : 'other';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

describe('the hunters', () => {
  it('box:crowd-hunters queues 200: six in ten walkers, four in ten wisps, no slimes', async () => {
    const counts = census(await createHeadless({ scene: 'box:crowd-hunters' }));
    expect([counts.walker + counts.wisp, counts.slime]).toEqual([200, 0]);
    expect(Math.abs(counts.walker - 120)).toBeLessThan(25);
  }, 120_000);

  it('are the mix hunters of box.crowd.mix, on the crowd at 1,000 too', async () => {
    const counts = census(await createHeadless({ scene: 'box:crowd-1000', settings: { 'box.crowd.mix': 'hunters' } }));
    expect([counts.walker + counts.wisp, counts.slime]).toEqual([1000, 0]);
    expect(Math.abs(counts.walker - 600)).toBeLessThan(50);
  }, 120_000);

  it('play the same twice: 120 steps of box:crowd-hunters give one hash', async () => {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run++) {
      const engine = await createHeadless({ scene: 'box:crowd-hunters' });
      engine.step(120);
      hashes.push(engine.hash());
    }
    expect(hashes[0]).toBe(hashes[1]);
  }, 120_000);

  it('leave the crowd as it was: the mix mixed queues what it queued before, member for member', async () => {
    expect(census(await createHeadless({ scene: 'box:crowd-1000' }))).toEqual({ walker: 523, slime: 290, wisp: 187 });
  }, 120_000);
});
