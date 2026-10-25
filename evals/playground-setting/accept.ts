/**
 * @file The acceptance of the eval task playground-setting (evals/playground-setting/prompt.md), run by `node x evals`
 * in the attempt's copy: `playground.gym.gravity` is a scene setting of the gym in m/s², 19.05 by default, 1 to 50;
 * under 9.81 the player jumps as high, his time in the air longer by √(19.05 / 9.81); and with it set to its default
 * the gym plays as with nothing set (the replays' goldens are the task's commands).
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../engine';
import { registry } from '../../engine/core/registry';
import '../../labs/playground/scenes/gym';

/** The player's jump in the gym: his highest point and the steps from the take-off until he lands. */
async function jump(settings: Record<string, unknown> = {}) {
  const engine = await createHeadless({ scene: 'playground:gym', settings });
  let [top, steps] = [0, 0];
  for (let k = 0; k < 200; k++) {
    engine.step(1, { b: ['jump'], ...(k === 0 ? { p: ['jump'] } : {}) });
    const [player] = engine.state('actor').entities as unknown as { actor: { y: number } }[];
    top = Math.max(top, player.actor.y);
    if (player.actor.y > 1e-3) steps = k + 1;
  }
  return { top, steps, hash: engine.hash() };
}

describe('playground.gym.gravity', () => {
  it('is a scene setting in m/s², Apex’s 19.05 by default, 1 to 50', () => {
    const setting = registry.get('setting', 'playground.gym.gravity') as unknown as Record<string, unknown>;
    expect(Math.abs((setting.default as number) - 19.05)).toBeLessThan(0.01);
    expect([setting.minimum, setting.maximum, setting.when, setting.type]).toEqual([1, 50, 'scene', 'number']);
    expect(String(setting.unit)).toMatch(/^m\/s(²|\^2|2)$/);
  });

  it('keeps the jump’s height under 9.81, the player longer in the air by √(19.05 / 9.81)', async () => {
    const [apex, earth] = [await jump(), await jump({ 'playground.gym.gravity': 9.81 })];
    expect(Math.abs(earth.top - apex.top)).toBeLessThan(0.05);
    expect(Math.abs(earth.steps / apex.steps - Math.sqrt(19.05 / 9.81))).toBeLessThan(0.06);
  }, 300_000);

  it('plays the gym at its default as with nothing set', async () => {
    expect((await jump({ 'playground.gym.gravity': 19.05 })).hash).toBe((await jump()).hash);
  }, 300_000);
});
