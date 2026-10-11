/**
 * @file Unit tests for the effects of a view (engine/gfx/fx/effects.ts), in Node: the fx page's fight
 * (tests/pages/fxScene.ts) steps to the same hashes with effects on, off, and turned off half way, while the effects
 * play its events, draw its telegraphs, bolts and trail and run its brazier; events burst the emitters answering them
 * (the sim's trace read once, without listening); a running emitter keeps its rate across frames and its light
 * flickers; the budgets hold under a flood (pools never grow, the excess counted, at most 7 draw calls); every pool is
 * registered with the warm-up, all its pages made before it.
 * @see engine/gfx/fx/effects.ts
 */
import { PerspectiveCamera, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { createFxScene } from '../../../tests/pages/fxScene';
import { createEffects, FX_BUDGET, type Effects } from './effects';
import { getEmitter, lightLevel } from './emitters';

/** The fx page's camera: over the yard's south side, looking at its middle. */
function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  view.position.set(6, 7, 12);
  view.lookAt(6, 0, 4);
  view.updateMatrixWorld();
  return view;
}

/** What a run of the fx scene gave: its hashes, and the most the effects drew in one frame. */
interface Run {
  hashes: string[];
  most: { telegraphs: number; ribbons: number; sprites: number; drawCalls: number; lights: number };
  fx: Effects | null;
}

/** Steps the fx scene `steps` times, drawing a frame after each with effects (until `offAt`) or none. */
function run(steps: number, effects: boolean, offAt = Infinity): Run {
  const scene = createFxScene({ seed: 7 });
  const fx = effects ? createEffects({ fxRng: (...keys) => scene.world.fxRng(...keys) }) : null;
  const view = camera();
  const hashes: string[] = [];
  const most = { telegraphs: 0, ribbons: 0, sprites: 0, drawCalls: 0, lights: 0 };
  for (let i = 0; i < steps; i++) {
    scene.world.step();
    hashes.push(scene.world.hash());
    if (!fx) continue;
    if (i === offAt) fx.enabled = false;
    scene.draw(fx);
    fx.shake.apply(view);
    fx.frame(1 / 60, view);
    fx.shake.restore(view);
    const stats = fx.stats();
    most.telegraphs = Math.max(most.telegraphs, stats.decals);
    most.ribbons = Math.max(most.ribbons, stats.ribbons);
    most.sprites = Math.max(most.sprites, stats.sprites);
    most.drawCalls = Math.max(most.drawCalls, stats.drawCalls);
    most.lights = Math.max(most.lights, fx.lights().length);
  }
  return { hashes, most, fx };
}

/** A warm-up that records what is registered. */
function recorder() {
  const entries = new Map<string, () => readonly Object3D[]>();
  return {
    entries,
    register(id: string, entry: { objects(): readonly Object3D[] }) {
      entries.set(id, () => entry.objects());
      return { dispose: () => entries.delete(id) };
    },
  };
}

describe('effects and the sim hash', () => {
  it('leave the hash the same with effects on, off, and turned off half way, while drawing the fight', () => {
    const off = run(600, false);
    const on = run(600, true);
    expect(on.hashes).toEqual(off.hashes);
    expect(run(600, true, 300).hashes).toEqual(off.hashes);
    const stats = on.fx!.stats();
    expect(stats.events, 'hits, slams, shots, explosions and falls played').toBeGreaterThan(20);
    expect(stats.particles.born).toBeGreaterThan(1000);
    expect(stats.particles.dropped).toBe(0);
    expect(on.most.telegraphs, 'telegraphs (and rings) on the floor at once').toBeGreaterThanOrEqual(2);
    expect(on.most.ribbons).toBe(1);
    expect(on.most.lights, "the brazier's light and a bolt's").toBeGreaterThanOrEqual(2);
    expect(on.most.drawCalls).toBeLessThanOrEqual(7);
  });

  it('draws nothing and draws no random number while off', () => {
    const scene = createFxScene({ seed: 7 });
    const fx = createEffects({ fxRng: (...keys) => scene.world.fxRng(...keys) });
    fx.enabled = false;
    for (let i = 0; i < 120; i++) {
      scene.world.step();
      scene.draw(fx);
      fx.frame(1 / 60, camera());
    }
    expect(fx.stats()).toMatchObject({ sprites: 0, decals: 0, ribbons: 0, events: 0, drawCalls: 0 });
    expect(fx.stats().particles.born).toBe(0);
    fx.enabled = true;
    expect(fx.feed(scene.world.events.trace()), 'the events seen while off are not played').toBe(0);
  });
});

describe('events', () => {
  it('burst every emitter answering the type, at the position, with its shake', () => {
    const fx = createEffects({ registry: createRegistry() });
    expect(fx.event('hit', { position: [0, 1, 0] })).toBe(17); // 16 sparks and a star
    expect(fx.shake.amount).toBeCloseTo(0.03, 12);
    expect(fx.event('nothing answers this', { position: [0, 1, 0] })).toBe(0);
    expect(fx.event('hit', {}), 'no position: nothing').toBe(0);
    expect(fx.event('hit', { x: 1, z: 2, size: 2 })).toBe(34); // twice the sparks, and two stars twice the size
    expect(fx.stats().events).toBe(2);
  });

  it("play the sim's trace once, by its numbers", () => {
    const fx = createEffects({ registry: createRegistry() });
    const trace = [
      { seq: 1, type: 'hit', payload: { position: [0, 1, 0] } },
      { seq: 2, type: 'nearMiss', payload: { position: [0, 1, 0] } },
      { seq: 3, type: 'slain', payload: { x: 2, y: 0, z: 2 } },
    ];
    expect(fx.feed(trace)).toBe(2);
    expect(fx.feed(trace)).toBe(0);
    expect(fx.feed([...trace, { seq: 4, type: 'land', payload: { position: [0, 0, 0] } }])).toBe(1);
  });

  it('draw a floor ring growing and fading with an explosion', () => {
    const fx = createEffects({ registry: createRegistry() });
    fx.event('explosion', { position: [0, 0.5, 0], ground: 0 });
    const counts = [0, 1, 2, 3].map(() => {
      fx.frame(0.15, camera());
      return fx.stats().decals;
    });
    expect(counts).toEqual([1, 1, 0, 0]); // 0.4 s
  });

  it('lay a decal of their own, a scorch that fades over its life', () => {
    const fx = createEffects({ registry: createRegistry() });
    fx.decal([1, 0, 1], { radius: [0.5, 0.5], width: 1, color: '#201810', alpha: 0.8, life: 2 });
    const counts = [0, 1, 2, 3].map(() => {
      fx.frame(0.6, camera());
      return fx.stats().decals;
    });
    expect(counts).toEqual([1, 1, 1, 0]);
  });
});

describe('running emitters', () => {
  it('keep their rate across frames and flicker their light', () => {
    const fx = createEffects({ registry: createRegistry() });
    const view = camera();
    const levels: number[] = [];
    for (let i = 0; i < 60; i++) {
      fx.emit('emitter:fire', [0, 0, 0], 'brazier');
      fx.frame(1 / 60, view);
      levels.push(fx.lights()[0].intensity);
    }
    expect(fx.stats().particles.born).toBe(70); // shardfall's fire: 70 a second
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(30 * (1 - 0.7 * 0.6));
    expect(Math.max(...levels)).toBeLessThanOrEqual(30);
    expect(new Set(levels).size).toBeGreaterThan(30);
    expect(fx.lights()[0]).toMatchObject({ position: [0, 0.4, 0], color: '#ffb070', distance: 10, decay: 2 });
  });

  it("follow shardfall's flicker and pulse", () => {
    const light = { ...getEmitter('emitter:fire', createRegistry()).light, flicker: 0, pulse: 0 };
    expect(lightLevel(light, 3, 1)).toBe(30);
    const pulsing = [0, 0.25, 0.5, 0.75].map((t) => lightLevel({ ...light, pulse: 1 }, t, 0));
    pulsing.forEach((k, i) => expect(k).toBeCloseTo(30 * (0.55 + 0.45 * Math.sin(i * 0.25 * 2 * Math.PI)), 12));
  });
});

describe('bolts and trails', () => {
  it('draw a halo and a core for each bolt, the first four lit', () => {
    const fx = createEffects({ registry: createRegistry() });
    for (let i = 0; i < 6; i++) fx.bolt([i, 1, 0]);
    fx.trail([{ base: [0, 1, 0], tip: [0, 1.5, 0] }], '#d8f2ff'); // one sample: no ribbon
    fx.trail(
      [
        { base: [0, 1, 0], tip: [0, 1.5, 0] },
        { base: [0.1, 1, 0], tip: [0.4, 1.4, 0] },
      ],
      '#d8f2ff',
    );
    fx.frame(1 / 60, camera());
    expect(fx.stats()).toMatchObject({ sprites: 12, ribbons: 1 });
    expect(fx.lights().map((light) => light.position[0])).toEqual([0, 1, 2, 3]);
    expect(fx.lights()[0]).toMatchObject({ color: '#ffb347', intensity: 10, distance: 2.5 });
    fx.frame(1 / 60, camera());
    expect(fx.stats()).toMatchObject({ sprites: 0, ribbons: 0 }); // this frame's shapes only
  });
});

describe('budgets', () => {
  it('never grow a pool: past the budgets nothing more is born or drawn, at most 7 draw calls', () => {
    const fx = createEffects({ registry: createRegistry() });
    const warmup = recorder();
    fx.register(warmup);
    const pages = () => [...warmup.entries.values()].flatMap((objects) => objects()).length;
    const before = pages();
    expect([...warmup.entries.keys()].sort()).toEqual(['fx:decals', 'fx:ribbons', 'fx:sprites']);
    expect(before, 'five sprite pages, a decal page, the ribbons').toBe(7);
    for (let i = 0; i < 40; i++) fx.event('explosion', { position: [i % 8, 1, 0], size: 1 });
    for (let i = 0; i < 1100; i++) fx.telegraph({ telegraph: 'telegraph:ring', position: [0, 0, i], yaw: 0, u: 0.5 });
    for (let i = 0; i < 40; i++) {
      fx.trail(
        [
          { base: [i, 1, 0], tip: [i, 2, 0] },
          { base: [i, 1, 1], tip: [i, 2, 1] },
        ],
        '#ff7a5a',
      );
    }
    for (let i = 0; i < 1200; i++) fx.bolt([0, 1, i]);
    fx.frame(1 / 60, camera());
    const stats = fx.stats();
    expect(stats.particles.live).toBe(FX_BUDGET.particles);
    expect(stats.particles.dropped).toBeGreaterThan(0);
    expect(stats.sprites).toBe(FX_BUDGET.particles + FX_BUDGET.glows);
    expect([stats.decals, stats.ribbons]).toEqual([FX_BUDGET.decals, FX_BUDGET.ribbons]);
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.drawCalls).toBe(7);
    expect(pages(), 'no page was added').toBe(before);
  });
});
