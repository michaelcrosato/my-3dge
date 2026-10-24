/**
 * @file Unit tests for the digitigrade biped (fixtures/rigs/biped/index.ts, PLAN.md WP 10.1): its rig passes the
 * check (finite, on the floor, its bones their lengths, the same every run and at any step); walking, running and
 * stopping, its toes take turns and stand planted, its hocks behind them; its tail swings wider at a run; it looks left
 * when told; it blinks.
 * @see fixtures/rigs/biped/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3 } from '../../../engine/sim-api';
import { Biped, BIPED } from './index';

const index = (name: string) => BIPED.names.indexOf(name);

describe('the digitigrade biped', () => {
  it('passes the rig check in every state', () => {
    const report = rigCheck(BIPED);
    expect(report.problems.map((p) => p.message)).toEqual([]);
  });

  it('walks on its toes, taking turns, its hocks behind them; its tail swings wider at a run; it looks and blinks', () => {
    const raptor = new Biped();
    let [both, swing] = [0, 0];
    for (let i = 0; i < 240; i++) {
      raptor.step({ velocity: new Vector3(0, 0, i < 90 ? 1.2 : i < 180 ? 3 : 0) }); // a walk, a run and a stop
      if (raptor.gait.lifted() > 1) both++;
      const p = raptor.points();
      expect(p[index('hockL')].z).toBeLessThan(p[index('toeL')].z); // the reverse knee: the hock behind the toe
      const tip = p[index('tail5')].x - p[index('tail0')].x;
      if (i >= 90 && i < 180) swing = Math.max(swing, Math.abs(tip));
    }
    expect(both).toBe(0); // one leg a group: never both feet up, stopping too
    const calm = new Biped();
    let walked = 0;
    for (let i = 0; i < 90; i++) walked = Math.max(walked, Math.abs((calm.step({ velocity: new Vector3(0, 0, 1.2) }), calm.points()[index('tail5')].x - calm.points()[index('tail0')].x))); // prettier-ignore
    expect(swing).toBeGreaterThan(walked * 1.3); // wider at a run
    const looking = new Biped();
    for (let i = 0; i < 60; i++) looking.step({ look: new Vector3(1, 1.6, 1.2) });
    const [head, eye] = [looking.points()[index('head')], looking.points()[index('eye')]];
    expect(eye.x - head.x).toBeGreaterThan(0.02); // to its left (+X)
    const blinker = new Biped({ seed: 3 });
    const opens = Array.from({ length: 600 }, () => blinker.step().blink.open);
    expect(Math.min(...opens)).toBeLessThan(0.1); // a blink within 10 s
  });
});
