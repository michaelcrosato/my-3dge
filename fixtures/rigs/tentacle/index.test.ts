/**
 * @file Unit tests for the tentacled creature (fixtures/rigs/tentacle/index.ts, PLAN.md WP 10.1): its rig passes the
 * check in every state; crawling, its tentacles trail behind over the floor and its sac swings back; waving, its raised
 * arm beats up and down, its tip trailing.
 * @see fixtures/rigs/tentacle/index.ts
 */
import { describe, expect, it } from 'vitest';
import { rigCheck, Vector3 } from '../../../engine/sim-api';
import { Tentacled, TENTACLE, TENTACLE_SIZE } from './index';

const at = (octopus: Tentacled, name: string) => octopus.points()[TENTACLE.names.indexOf(name)];

describe('the tentacled creature', () => {
  it('passes the rig check in every state', () => {
    expect(rigCheck(TENTACLE).problems.map((p) => p.message)).toEqual([]);
  });

  it('trails its tentacles as it crawls, swings its sac back, and beats its raised arm when it waves', () => {
    const octopus = new Tentacled();
    for (let i = 0; i < 60; i++) octopus.step();
    const still = at(octopus, 'arm0 4').z - at(octopus, 'core').z;
    const sacStill = at(octopus, 'sac').z - at(octopus, 'core').z;
    let swung = 0;
    for (let i = 0; i < 60; i++) {
      octopus.step({ velocity: new Vector3(0, 0, 1.5) });
      swung = Math.min(swung, at(octopus, 'sac').z - at(octopus, 'core').z - sacStill);
      for (const p of octopus.points()) expect(p.y).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(at(octopus, 'arm0 4').z - at(octopus, 'core').z).toBeLessThan(still - 0.01); // trailing back
    expect(swung).toBeLessThan(-0.005); // the sac swung behind as it set off
    const waving = new Tentacled();
    const heights: number[] = [];
    for (let i = 0; i < 90; i++) heights.push(at(waving.step({ wave: true }), 'waver 4').y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.1); // up and down
    expect(waving.trail.samples.length).toBeGreaterThan(3);
    expect(at(waving, 'waver 4').distanceTo(at(waving, 'waver 0'))).toBeLessThanOrEqual(4 * TENTACLE_SIZE.link + 1e-9);
  });
});
