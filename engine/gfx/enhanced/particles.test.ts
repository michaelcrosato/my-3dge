/**
 * @file Unit tests for GPU particles (engine/gfx/enhanced/particles.ts), the CPU's side of them in Node: the feature
 * entry, turned off, says what the picture loses; a burst's births are the CPU pool's own, float for float; the step
 * takes the births since the last one and covers the slots ever used, the ring wrapping onto its oldest; births past
 * the most a step takes are dropped and counted; the counts and `live` follow each particle's life with no readback;
 * the warm frame draws a slot whatever lives; `bounds()` follows a birth's flight; and `clear()` forgets them all.
 * @see engine/gfx/enhanced/particles.ts
 */
import { describe, expect, it } from 'vitest';
import type { ComputeNode } from 'three/webgpu';
import { createLog } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { Rng } from '../../core/rng';
import { createSettings } from '../../core/settings';
import { defineFeatures, resolveFeatures } from '../features';
import { emitterKind, getEmitter, particleSpec } from '../fx/emitters';
import { PARTICLE_STRIDE, ParticlePool } from '../fx/particles';
import { createGpuParticles, PARTICLES_FEATURE } from './particles';

/** A renderer that records each step's dispatch. */
function recorder() {
  const counts: number[] = [];
  return { counts, compute: (_node: ComputeNode, count?: number) => counts.push(count ?? -1) };
}

/** A spec that lives `life` s, rising at 2 m/s without gravity, drag or swirl. */
function rising(life = 1) {
  const registry = createRegistry();
  emitterKind(registry);
  return particleSpec(getEmitter('emitter:sparks', registry), {
    life: [life, life],
    velocity: [0, 2, 0],
    spread: 0,
    gravity: 0,
    drag: 0,
    turbulence: 0,
    lands: false,
    area: [0, 0, 0],
  });
}

describe('feature:gpuParticles', () => {
  it('is a feature entry, and off it says what the picture loses', () => {
    const registry = createRegistry();
    defineFeatures(registry);
    const { id, ...spec } = PARTICLES_FEATURE;
    if (!registry.has('feature', id)) registry.def('feature', id, spec);
    const settings = createSettings({ registry });
    settings.set('gfx.featuresOff', [id]);
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const adapter = { vendor: '', architecture: '', device: '', description: '', fallback: false };
    const limits = { maxStorageBufferBindingSize: 2 ** 27 };
    const report = resolveFeatures({ adapter, features: [], limits }, { registry, settings, log });
    const off = report.off.find((feature) => feature.id === id);
    expect(off).toEqual({ id, advice: spec.advice, reason: 'gfx.featuresOff lists it' });
    expect(printed.filter((line) => line.includes(spec.advice))).toEqual([expect.stringContaining(spec.downgrade)]);
  });
});

describe('createGpuParticles', () => {
  it('births a burst as the CPU pool does, float for float, from the same draws', () => {
    const registry = createRegistry();
    emitterKind(registry);
    const spec = particleSpec(getEmitter('emitter:sparks', registry));
    const ring = createGpuParticles({ slots: 64 });
    const pool = new ParticlePool(64);
    ring.burst(spec, 12, [1, 2, 3], new Rng(7), { velocity: [0, 1, 0], scale: 1.5 });
    pool.burst(spec, 12, [1, 2, 3], new Rng(7), { velocity: [0, 1, 0], scale: 1.5 });
    const floor = 13; // PARTICLE_FLOATS.floor: the ring keeps a finite floor where the pool has none
    const expected = Array.from(pool.data.subarray(0, 12 * PARTICLE_STRIDE), (value, i) =>
      i % PARTICLE_STRIDE === floor && value === -Infinity ? -1e9 : Math.fround(value),
    );
    expect(Array.from(ring.waiting())).toEqual(expected);
  });

  it('steps the births since the last step over every slot used, wrapping onto the oldest', () => {
    const ring = createGpuParticles({ slots: 8 });
    const renderer = recorder();
    ring.step(renderer); // nothing asked: no dispatch
    ring.burst(rising(), 6, [0, 0, 0], new Rng(1));
    ring.update(1 / 60, 0);
    ring.step(renderer);
    expect([renderer.counts, ring.mesh.count, ring.waiting().length]).toEqual([[6], 6, 0]);
    ring.burst(rising(), 6, [0, 0, 0], new Rng(2)); // slots 6, 7, then 0 to 3 again
    ring.update(1 / 60, 1 / 60);
    ring.step(renderer);
    expect([renderer.counts, ring.mesh.count]).toEqual([[6, 8], 8]);
    expect(ring.stats()).toEqual({ live: 8, capacity: 8, born: 12, dropped: 0, recycled: 4 });
  });

  it('drops the births past the most a step takes, and counts them', () => {
    const ring = createGpuParticles({ slots: 64, births: 4 });
    expect(ring.burst(rising(), 6, [0, 0, 0], new Rng(1))).toBe(4);
    expect(ring.stats()).toMatchObject({ born: 4, dropped: 2 });
    ring.update(1 / 60, 0);
    ring.step(recorder());
    expect(ring.burst(rising(), 3, [0, 0, 0], new Rng(1))).toBe(3); // a new step, room again
  });

  it('counts the live ones by their lives, with no readback, and draws nothing once they are gone', () => {
    const ring = createGpuParticles({ slots: 32 });
    const renderer = recorder();
    ring.burst(rising(1), 10, [0, 0, 0], new Rng(1));
    expect(ring.live).toBe(true); // waiting to be born
    ring.update(0.5, 0.5);
    ring.step(renderer);
    expect([ring.stats().live, ring.live, ring.mesh.count]).toEqual([10, true, 10]);
    ring.update(0.6, 1.1);
    ring.step(renderer);
    expect([ring.stats().live, ring.live, ring.mesh.count]).toEqual([0, false, 0]);
  });

  it('draws a slot in the warm frame whatever lives, and steps it so the step is built too', () => {
    const ring = createGpuParticles({ slots: 16 });
    const renderer = recorder();
    ring.warm(true);
    expect(ring.mesh.count).toBe(1);
    ring.step(renderer);
    expect(renderer.counts).toEqual([1]);
    ring.warm(false);
    expect(ring.mesh.count).toBe(0);
  });

  it('estimates where they are from their births, for the gallery to frame them', () => {
    const ring = createGpuParticles({ slots: 16 });
    expect(ring.bounds()).toBe(null);
    ring.burst(rising(2), 4, [1, 1, -1], new Rng(1));
    ring.update(0.5, 0.5);
    const box = ring.bounds()!;
    expect([...box.min, ...box.max].map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 2, -1, 1, 2, -1]);
  });

  it('forgets every particle on clear', () => {
    const ring = createGpuParticles({ slots: 16 });
    ring.burst(rising(), 5, [0, 0, 0], new Rng(1));
    ring.update(1 / 60, 0);
    ring.step(recorder());
    ring.clear();
    expect([ring.stats().live, ring.live, ring.mesh.count, ring.waiting().length]).toEqual([0, false, 0, 0]);
  });
});
