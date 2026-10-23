/**
 * @file Unit tests for footsteps by surface and gait (engine/world/footsteps.ts, PLAN.md WP 13.22): every
 * surface's step is one of the engine's effects, its own for the seven surfaces and concrete for any other tag; the
 * gaits grow louder from a crouch to a sprint and a slide has none; a speed names the gait between the movement
 * model's.
 * @see engine/world/footsteps.ts
 */
import { describe, expect, it } from 'vitest';
import { getSfx } from '../audio/data/sfx';
import { footstepSound, STEP_GAITS, stepGait, SURFACE_STEPS } from './footsteps';

describe('footsteps', () => {
  it('play the engine’s step for each surface, its own for the seven and concrete for any other tag', () => {
    for (const sfx of Object.values(SURFACE_STEPS)) expect(getSfx(sfx).id).toBe(sfx);
    const surfaces = ['wood', 'tile', 'carpet', 'concrete', 'grass', 'gravel', 'metal'];
    expect(new Set(surfaces.map((tag) => footstepSound(tag, 'walk')!.sfx)).size).toBe(7);
    expect(footstepSound('stone', 'walk')!.sfx).toBe('sfx:stepConcrete');
    expect(footstepSound('lava', 'walk')!.sfx).toBe('sfx:stepConcrete');
    expect(footstepSound('constructor', 'walk')!.sfx).toBe('sfx:stepConcrete'); // an own key, never Object's
  });

  it('grow louder from a crouch to a sprint; a slide has none', () => {
    const vols = (['crouch', 'walk', 'run', 'sprint'] as const).map((gait) => footstepSound('wood', gait)!.vol);
    expect(vols).toEqual([...vols].sort((a, b) => a - b));
    expect(new Set(vols).size).toBe(4);
    expect(footstepSound('wood', 'slide')).toBeNull();
    expect(STEP_GAITS.slide).toBeNull();
  });

  it('name the gait a speed has between the movement model’s walk, run and sprint', () => {
    expect([1.7, 2.5, 4.4, 5.3, 6.6].map(stepGait)).toEqual(['walk', 'walk', 'run', 'run', 'sprint']);
  });
});
