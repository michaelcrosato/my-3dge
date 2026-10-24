/**
 * @file Unit tests for the stage's effects (engine/gfx/stageFx.ts), in Node: the kinds it draws are asked of the
 * component entries (a component declaring the projectile's fields is a bolt, one declaring a telegraph's place is a
 * telegraph, whatever their names); a flying bolt is drawn between its last two places and a stopped one is not; a
 * telegraph is drawn while it names one; an actor's trail becomes a ribbon; the trace's events burst once; turned
 * off, it draws nothing and claims no bolt (the stage stands it in); reset forgets what ran; and it makes the GPU's
 * particle ring only where the feature is on and an emitter asks for it, those emitters alone bursting there.
 * @see engine/gfx/stageFx.ts
 */
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { TrailSample } from '../anim/character';
import { createRegistry } from '../core/registry';
import { defineComponent } from '../sim/state';
import { PROJECTILE, PROJECTILE_FIELDS } from '../world/projectiles';
import { defineEmitter, emitterKind } from './fx/emitters';
import { createStageFx, fxKinds } from './stageFx';

/** A registry with a bolt kind, a telegraph kind and a plain one. */
function kinds() {
  const registry = createRegistry();
  defineComponent('arrow', { description: 'A shot.', fields: PROJECTILE_FIELDS }, registry);
  const number = (description: string) => ({ type: 'number', default: 0, description }) as const;
  defineComponent(
    'warning',
    {
      description: 'A telegraph where it stands.',
      fields: {
        telegraph: { type: 'string', default: '', description: 'Its id.' },
        position: { type: 'array', items: { type: 'number' }, default: [0, 0, 0], description: 'Where.' },
        yaw: number('Facing.'),
        u: number('Wind-up.'),
      },
    },
    registry,
  );
  defineComponent('dot', { description: 'A dot.', fields: { x: number('East.'), z: number('South.') } }, registry);
  return registry;
}

const camera = () => {
  const view = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  view.position.set(0, 6, 8);
  view.lookAt(0, 0, 0);
  view.updateMatrixWorld();
  return view;
};

describe('the stage’s effects', () => {
  it('asks the component entries which kinds are bolts and telegraphs', () => {
    expect(fxKinds(kinds())).toEqual({ bolts: ['arrow'], telegraphs: ['warning'] });
    expect(fxKinds(createRegistry())).toEqual({ bolts: [], telegraphs: [] });
  });

  it('draws a flying bolt between its last two places, a telegraph while it names one, and a trail as a ribbon', () => {
    const trail: TrailSample[] = [0, 1, 2].map((k) => ({
      base: new Vector3(k * 0.2, 1, 0),
      tip: new Vector3(k * 0.2, 1.6, 0.3),
      clock: k / 60,
      weight: 1,
    }));
    const fx = createStageFx({ registry: kinds(), trails: () => new Map([[1, trail]]) });
    const bolt = (x: number, state = 'flying') => ({ arrow: { ...PROJECTILE, x, y: 1, state } });
    const warning = (telegraph: string) => ({ warning: { telegraph, position: [0, 0, 0], yaw: 0, u: 0.5 } });
    expect([
      ...fx.capture([
        { id: 2, ...bolt(0) },
        { id: 3, ...warning('telegraph:arc') },
      ]),
    ]).toEqual([2]);
    expect([
      ...fx.capture([
        { id: 2, ...bolt(1) },
        { id: 3, ...warning('telegraph:arc') },
      ]),
    ]).toEqual([2]);
    fx.draw(0.5);
    fx.frame(1 / 60, camera(), []);
    const stats = fx.effects.stats();
    expect([stats.decals, stats.ribbons, stats.sprites]).toEqual([1, 1, 2]); // the arc; the trail; the bolt's halo and core
    expect([
      ...fx.capture([
        { id: 2, ...bolt(2, 'hit') },
        { id: 3, ...warning('') },
      ]),
    ]).toEqual([]);
    fx.draw(1);
    fx.frame(1 / 60, camera(), []);
    expect([fx.effects.stats().decals, fx.effects.stats().sprites]).toEqual([0, 0]);
  });

  it('bursts the trace’s events once, draws nothing turned off, and forgets what ran on reset', () => {
    const fx = createStageFx({ registry: kinds() });
    const trace = [{ seq: 1, type: 'hit', payload: { position: [0, 1, 0] } }];
    fx.frame(1 / 60, camera(), trace);
    const live = fx.effects.stats().particles.live;
    expect(live).toBeGreaterThan(0);
    fx.frame(1 / 60, camera(), trace); // read once
    expect(fx.effects.stats().events).toBe(1);
    fx.reset();
    expect(fx.effects.stats().particles.live).toBe(0);
    fx.effects.enabled = false;
    fx.capture([{ id: 2, warning: { telegraph: 'telegraph:arc', position: [0, 0, 0], yaw: 0, u: 1 } }]);
    fx.frame(1 / 60, camera(), [{ seq: 2, type: 'hit', payload: { position: [0, 1, 0] } }]);
    expect([fx.effects.stats().decals, fx.effects.stats().particles.live]).toEqual([0, 0]);
  });

  it('claims no bolt turned off, so the stage draws it as a stand-in; on again, it starts where it is', () => {
    const fx = createStageFx({ registry: kinds() });
    const bolt = (x: number) => ({ id: 2, arrow: { ...PROJECTILE, x, y: 1, state: 'flying' } });
    expect([...fx.capture([bolt(0)])]).toEqual([2]);
    fx.effects.enabled = false;
    expect([...fx.capture([bolt(1)])]).toEqual([]);
    fx.draw(0.5);
    fx.frame(1 / 60, camera(), []);
    expect(fx.effects.stats().sprites).toBe(0);
    fx.effects.enabled = true;
    expect([...fx.capture([bolt(3)])]).toEqual([2]);
    fx.draw(0); // from where it is, not from x = 0 before it was turned off
    fx.frame(1 / 60, camera(), []);
    expect(fx.effects.stats().sprites).toBe(2); // its halo and core
    expect(fx.effects.lights()[0]?.position[0]).toBeCloseTo(3, 9);
  });

  it("makes the GPU's ring where the feature is on and an emitter asks for it, and bursts only those emitters there", () => {
    const on = { on: ['feature:gpuParticles'], off: [], downgrades: [] };
    const warmup = { register: () => ({ dispose() {} }) };
    const plain = createStageFx({ registry: kinds() });
    plain.register(warmup, on); // no emitter asks for the GPU: no ring
    const registry = kinds();
    emitterKind(registry);
    defineEmitter('emitter:drizzle', { rate: 600, life: [1, 1], gpu: true }, registry);
    const off = createStageFx({ registry });
    off.register(warmup); // no report: the feature is off
    const wet = createStageFx({ registry });
    wet.register(warmup, on);
    expect([plain.gpuParticles, off.gpuParticles, wet.gpuParticles !== null, wet.effects.gpuParticles === wet.gpuParticles]).toEqual([null, null, true, true]); // prettier-ignore
    wet.effects.emit('emitter:drizzle', [0, 5, 0], 'drizzle');
    wet.effects.burst('emitter:sparks', [0, 1, 0]);
    wet.frame(1 / 60, camera(), []);
    const stats = wet.effects.stats();
    expect([stats.gpuParticles!.born, stats.particles.born > 0]).toEqual([10, true]); // 600 a second for 1/60 s; the sparks on the CPU
  });
});
