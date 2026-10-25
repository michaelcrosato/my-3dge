/**
 * @file Tests the performance governor (engine/dev/governor.ts, WP 7.5) on simulated frame times: three slow seconds
 * demote a tier and no fewer do; calm seconds promote one, never above where `auto` starts; a demotion soon after a
 * promotion doubles the calm, so a machine on the edge settles instead of flickering; a tier set by hand is kept and
 * `auto` starts again from its own tier; frozen, it holds, and told every frame that it is not, it still moves (only a
 * change of state starts a new second); on a touch screen the drawn pixels' scale follows the
 * frame rate; every move is advice; and a run whose governor moves tiers between its steps keeps the hash of a run
 * without one.
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../app/headless';
import { qualityBudget } from '../gfx/quality';
import { createGovernor, GOVERNOR } from './governor';
import '../../labs/box/scenes/room';

/** A governor whose advice is kept, and a way to feed it `seconds` at `fps`. */
function governed() {
  const advice: string[] = [];
  const governor = createGovernor({ log: { warnOnce: (code: string, values?: { tier?: string }) => (advice.push(`${code} ${values?.tier}`), true) } as never }); // prettier-ignore
  const run = (seconds: number, fps: number) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) governor.frame(1000 / fps);
  };
  return { governor, advice, run };
}

describe('the performance governor', () => {
  it('demotes after three slow seconds, promotes after calm ones, never above where auto starts', () => {
    const { governor, advice, run } = governed();
    expect(governor.budget('auto', false).tier).toBe('high');
    run(2, 30);
    expect(governor.budget('auto', false).tier).toBe('high'); // two slow seconds: not yet
    run(1, 30);
    expect(governor.budget('auto', false)).toEqual(qualityBudget('medium', false));
    run(GOVERNOR.drop, 30);
    expect(governor.budget('auto', false).tier).toBe('low');
    run(GOVERNOR.drop, 30);
    expect(governor.budget('auto', false).tier).toBe('low'); // the bottom
    run(GOVERNOR.calmStart - 1, 60);
    expect(governor.budget('auto', false).tier).toBe('low');
    run(1, 60);
    expect(governor.budget('auto', false).tier).toBe('medium');
    run(GOVERNOR.calmStart * 2, 60);
    expect(governor.budget('auto', false).tier).toBe('high');
    run(GOVERNOR.calmStart * 3, 60);
    expect(governor.budget('auto', false).tier).toBe('high'); // never above auto's own
    expect(advice).toEqual(['GFX_GOVERNOR medium', 'GFX_GOVERNOR low', 'GFX_GOVERNOR medium', 'GFX_GOVERNOR high']);
    run(30, 54); // between the two: neither good nor bad
    expect(governor.state()).toMatchObject({ tier: 'high', bad: 0, good: 0 });
  });

  it('settles a machine on the edge: each relapse soon after a promotion doubles the calm, up to its most', () => {
    // a machine slow at high (30 frames a second) and smooth at medium (60), for five minutes, a second at a time
    const { governor, run } = governed();
    let [seconds, atMedium] = [0, 0];
    while (seconds < 300) {
      const tier = governor.budget('auto', false).tier;
      run(1, tier === 'high' ? 30 : 60);
      [seconds, atMedium] = [seconds + 1, atMedium + (tier === 'medium' ? 1 : 0)];
    }
    expect(governor.state().calm).toBe(GOVERNOR.calmMax);
    expect(governor.state().moves).toBe(11); // a try at high at 13, 36, 79, 162 and 245 s; without the doubling, 46
    expect(atMedium / seconds).toBeGreaterThan(0.85);
  });

  it('keeps a tier set by hand, rests, and starts auto again from its own tier; frozen, it holds', () => {
    const { governor, run } = governed();
    governor.budget('auto', false);
    run(GOVERNOR.drop, 20);
    expect(governor.budget('auto', false).tier).toBe('medium');
    expect(governor.budget('high', false)).toEqual(qualityBudget('high', false));
    run(GOVERNOR.drop * 2, 20); // slow, but quality is set by hand
    expect(governor.state().tier).toBeNull();
    expect(governor.budget('auto', true).tier).toBe('medium'); // auto's own on a touch screen
    governor.freeze(true);
    run(GOVERNOR.drop * 3, 20);
    expect(governor.budget('auto', true).tier).toBe('medium');
    governor.freeze(false);
    run(GOVERNOR.drop, 20);
    expect(governor.budget('auto', true).tier).toBe('low');
  });

  it('moves under a page that says it is not frozen before every frame, as engine/app/engine.ts does', () => {
    const { governor } = governed();
    for (let i = 0; i < (GOVERNOR.drop + 1) * 25; i++) {
      governor.freeze(false); // the page's draw, each frame (Codex on #34: each call used to start a new second)
      governor.frame(40);
      governor.budget('auto', false); // the frame's pixel caps (engine/app/drawing.ts)
    }
    expect(governor.budget('auto', false).tier).toBe('medium'); // three slow seconds counted: one tier down
    expect(governor.state().seconds).toBeGreaterThanOrEqual(GOVERNOR.drop);
  });

  it('on a touch screen, scales the drawn pixels down with each slow second and back up with calm ones', () => {
    const { governor, run } = governed();
    governor.budget('auto', true);
    run(2, 40);
    const shrunk = governor.budget('auto', true);
    expect(governor.state().scale).toBeCloseTo(GOVERNOR.scale.down ** 2, 9);
    expect(shrunk.maxPixels).toBeCloseTo(1e6 * GOVERNOR.scale.down ** 4, 3); // medium's megapixel, scale squared
    run(30, 40);
    expect(governor.state().scale).toBe(GOVERNOR.scale.min);
    expect(governor.budget('auto', false).maxPixels).toBe(qualityBudget('low', false).maxPixels); // the desktop never scales
    governor.budget('auto', true);
    run(200, 60);
    expect(governor.state().scale).toBe(1);
  });

  it('moves tiers between a run’s steps and leaves its hash as a run without it', async () => {
    const plain = await createHeadless({ scene: 'box:room', seed: 3 });
    const governedRun = await createHeadless({ scene: 'box:room', seed: 3 });
    const { governor, run } = governed();
    governor.budget('auto', false);
    for (let i = 0; i < 20; i++) {
      plain.step(6);
      run(GOVERNOR.drop, i % 4 < 2 ? 25 : 60);
      governedRun.step(6);
      governor.budget('auto', false); // as the page reads it each frame
    }
    expect(governor.state().moves).toBeGreaterThan(1);
    expect(governedRun.hash()).toBe(plain.hash());
  });
});
