/**
 * @file Unit tests for the hexapod (fixtures/rigs/hexapod/index.ts, PLAN.md WP 10.1): its rig passes the check in
 * every state; it walks on alternate tripods, its planted feet still, and turns where it stands on them too; along a
 * wall its right feet grip the wall's face; its abdomen swings out behind as it turns; its body tilts up a step its
 * front feet stand on.
 * @see fixtures/rigs/hexapod/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3, type GroundHit } from '../../../engine/sim-api';
import { Hexapod, HEXAPOD, HEXAPOD_LEGS, hexapodWorld } from './index';

describe('the hexapod', () => {
  it('passes the rig check in every state', () => {
    expect(rigCheck(HEXAPOD).problems.map((p) => p.message)).toEqual([]);
  });

  it('walks on tripods, grips a wall at its right, swings its abdomen as it turns, and tilts up a step', () => {
    const bug = new Hexapod();
    for (let i = 0; i < 120; i++) {
      bug.step({ velocity: new Vector3(0, 0, 0.6) });
      const up = bug.gait.feet.flatMap((foot, k) => (foot.t >= 0 ? [HEXAPOD_LEGS[k].group] : []));
      expect(new Set(up).size).toBeLessThanOrEqual(1); // one tripod at a time
    }
    const climber = new Hexapod({ probe: hexapodWorld(0, 0.2) });
    for (let i = 0; i < 90; i++) climber.step({ velocity: new Vector3(0, 0, 0.4) });
    const right = climber.gait.feet.filter((foot, k) => HEXAPOD_LEGS[k].rest[0] < 0 && foot.t < 0);
    expect(right.length).toBeGreaterThan(0);
    for (const foot of right) expect([foot.position.x, foot.normal.x]).toEqual([expect.closeTo(-0.2, 9), 1]); // on its face
    const spinner = new Hexapod();
    let swung = 0;
    for (let i = 0; i < 40; i++) {
      spinner.step({ spin: 3 });
      const up = spinner.gait.feet.flatMap((foot, k) => (foot.t >= 0 ? [HEXAPOD_LEGS[k].group] : []));
      expect(new Set(up).size).toBeLessThanOrEqual(1); // one tripod at a time, turning where it stands too
      const [waist, tip] = [spinner.points()[3], spinner.points()[4]];
      const behind = new Vector3(-Math.sin(spinner.yaw), 0, -Math.cos(spinner.yaw));
      const out = tip.clone().sub(waist).setY(0).normalize();
      swung = Math.max(swung, Math.acos(Math.min(1, out.dot(behind))));
    }
    expect(swung).toBeGreaterThan(0.15); // it lags the turn
    const step = (o: Vector3, d: Vector3, max: number, hit: GroundHit) => {
      const top = d.y < 0 ? (0.05 - o.y) / d.y : Infinity; // a 5 cm step ahead of z 0.05
      const z = o.z + d.z * top;
      const t = z > 0.05 ? top : d.y < 0 ? -o.y / d.y : Infinity;
      if (!(t >= 0 && t <= max)) return false;
      hit.point.copy(o).addScaledVector(d, t);
      hit.normal.set(0, 1, 0);
      return true;
    };
    const tilted = new Hexapod({ probe: step });
    for (let i = 0; i < 60; i++) tilted.step();
    expect(tilted.pitch.value).toBeGreaterThan(0.05); // its front up
  });
});
