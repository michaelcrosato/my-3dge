/**
 * @file The acceptance of the eval task playground-dev-action (evals/playground-dev-action/prompt.md), run by
 * `node x evals` in the attempt's copy: the gym's dev action `launch` throws the player straight up at its `speed`,
 * 10 m/s by default, so he rises v² / 2g where he stood; a run with it is recorded, and its replay gives the run's hash;
 * and the gym's file comment documents it beside `place`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import { headlessHost } from '../../engine/app/headless';
import '../../labs/playground/scenes/gym';

type Engine = Awaited<ReturnType<typeof createHeadless>>;
const actions = (engine: Engine) => engine.actions as { run(name: string, args?: unknown): unknown };
const player = (engine: Engine) => (engine.state('actor').entities as unknown as { actor: { x: number; y: number; z: number } }[])[0].actor; // prettier-ignore

/** The player's highest point and where he lands after a launch with `args`, from where he stands at the spawn. */
async function launch(args?: { speed?: number }) {
  const engine = await createHeadless({ scene: 'playground:gym' });
  engine.step(30);
  const from = { ...player(engine) };
  actions(engine).run('launch', args);
  let top = 0;
  for (let k = 0; k < 180; k++) {
    engine.step(1);
    top = Math.max(top, player(engine).y);
  }
  return { top, from, to: player(engine), engine };
}

describe('the gym’s dev action launch', () => {
  it('throws the player straight up at 10 m/s by default: he rises v² / 2g and lands where he stood', async () => {
    const { top, from, to } = await launch();
    expect(Math.abs(top - 100 / (2 * 19.05))).toBeLessThan(0.05);
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeLessThan(0.05);
    expect(Math.abs(to.y - from.y)).toBeLessThan(0.01);
  }, 300_000);

  it('takes its speed: at 5 m/s he rises a quarter as high', async () => {
    expect(Math.abs((await launch({ speed: 5 })).top - 25 / (2 * 19.05))).toBeLessThan(0.05);
  }, 300_000);

  it('is recorded: the run’s replay gives its hash', async () => {
    const { engine } = await launch({ speed: 12 });
    const text = JSON.stringify(headlessHost(engine).session.record());
    expect(text).toContain('launch');
    const again = await createHeadless({ scene: 'playground:gym' });
    const replay = again.replay as (text: string, options: object) => Promise<{ hash: string }>;
    expect((await replay(text, {})).hash).toBe(engine.hash());
  }, 300_000);

  it('is documented beside place in the gym’s file comment', () => {
    const comment = /\/\*\*([\s\S]*?)\*\//.exec(readFileSync('labs/playground/scenes/gym.ts', 'utf8'))?.[1] ?? '';
    expect([comment.includes('`place`'), comment.includes('`launch`')]).toEqual([true, true]);
  });
});
