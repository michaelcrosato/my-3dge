/**
 * @file Unit tests for the chain's shading stage (engine/gfx/post/shading.ts): with none of the techniques' features
 * on it makes nothing and the light passes through as it is; with them on, a section runs when the look asks for it
 * and the quality tier allows it, and a section the tier turns off is said once (`GFX_POST_TIER`), however many frames
 * ask. What it draws is tests/e2e/enhanced.spec.ts's.
 */
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
import { qualityBudget } from '../quality';
import { chainOf, type FilterSpec } from './filters';
import { createScenePass } from './mrt';
import { createShading } from './shading';

/** Every section on, as a look asks for it. */
const ALL: FilterSpec = { ao: { scope: 'all' }, gi: { scope: 'all' }, air: { scope: 'all' }, ssr: { scope: 'all' } };

/** The techniques' features of the chain's shading. */
const ON = ['feature:ao', 'feature:gi', 'feature:air', 'feature:ssr'];

/** A stage over a scene pass, with `on` the features on, and the codes its log raised. */
function stage(on: string[]) {
  const scenePass = createScenePass(new Scene(), new PerspectiveCamera(), { metalrough: on.includes('feature:ssr') });
  const raised: string[] = [];
  const log = createLog({ console: { warn: (line) => raised.push(line), error: () => {} } });
  const shading = createShading({ scenePass, features: { on, off: [], downgrades: [] }, warming: () => false, log });
  return { shading, scenePass, raised };
}

describe('the shading stage', () => {
  it('makes nothing without its features: the light passes through as it is', () => {
    const { shading, scenePass } = stage([]);
    const colour = scenePass.getTextureNode('output');
    expect(shading.apply(colour)).toBe(colour);
    shading.sync(chainOf(ALL), qualityBudget('high', false), 'look:all');
    expect(shading.running).toEqual({ ao: false, gi: false, air: false, ssr: false });
  });

  it('runs what the look asks for and the tier allows, and says once what the tier turns off', () => {
    const { shading, scenePass, raised } = stage(ON);
    expect(shading.apply(scenePass.getTextureNode('output'))).not.toBe(scenePass.getTextureNode('output'));
    shading.sync(chainOf(ALL), qualityBudget('high', false), 'look:all');
    expect(shading.running).toEqual({ ao: true, gi: true, air: true, ssr: true });
    shading.sync(chainOf({ ...ALL, ao: { scope: 'all', strength: 0 }, ssr: { scope: 'off' } }), qualityBudget('high', false), 'look:all'); // prettier-ignore
    expect([shading.running.ao, shading.running.ssr]).toEqual([false, false]);
    expect(raised).toEqual([]);
    for (let frame = 0; frame < 3; frame++) shading.sync(chainOf(ALL), qualityBudget('medium', false), 'look:all');
    expect(shading.running).toEqual({ ao: true, gi: false, air: true, ssr: true }); // the haze stays, its shafts go
    const said = (effect: string) => raised.filter((line) => line.includes('GFX_POST_TIER') && line.includes(effect));
    expect([said('bounce light').length, said('light shafts').length, said('lamp halos').length]).toEqual([1, 1, 0]);
    shading.sync(chainOf({ ...ALL, air: { scope: 'all', haze: 0 } }), qualityBudget('low', false), 'look:all');
    expect(shading.running.air).toBe(false); // halos alone, and the low tier turns them off
    expect(said('lamp halos')).toHaveLength(1);
  });
});
