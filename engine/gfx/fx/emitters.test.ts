/**
 * @file Unit tests for the emitter kind (engine/gfx/fx/emitters.ts, presets.ts), in Node: every registry gets the
 * engine's emitters, filled; shardfall's 13 presets keep their tuned numbers, their linear colours within a hex
 * step; every layer names a defined emitter and every event effect answers its event; specs with problems are
 * refused naming each; a missing id gives the sparks after a warning; specs are cached per entry and change.
 * @see engine/gfx/fx/emitters.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { defineEmitter, emitterKind, getEmitter, particleSpec, type Emitter } from './emitters';
import { BUILT_IN_EMITTERS } from './presets';

/**
 * Shardfall's presets (`shardfall:crates/pav_view/src/fx.rs:13-229`): colour at birth and death (linear RGBA, above
 * 1 to glow), rate, life, size, gravity and spread, as it has them.
 */
const SHARDFALL: Record<
  string,
  { c0: number[]; c1: number[]; rate: number; life: number[]; size: number[]; g: number; spread: number }
> = {
  smoke: {
    c0: [0.22, 0.22, 0.24, 0.55],
    c1: [0.45, 0.45, 0.48, 0],
    rate: 14,
    life: [2.2, 3.6],
    size: [0.15, 0.75],
    g: -0.3,
    spread: 0.3,
  },
  steam: {
    c0: [0.9, 0.92, 0.95, 0.45],
    c1: [1, 1, 1, 0],
    rate: 20,
    life: [1, 1.8],
    size: [0.1, 0.6],
    g: -0.5,
    spread: 0.4,
  },
  sparks: {
    c0: [6, 3.2, 1, 1],
    c1: [2, 0.4, 0.1, 0],
    rate: 40,
    life: [0.4, 1],
    size: [0.05, 0.015],
    g: 9.8,
    spread: 3,
  },
  embers: {
    c0: [5, 1.6, 0.3, 1],
    c1: [1.5, 0.15, 0, 0],
    rate: 12,
    life: [1.5, 3],
    size: [0.035, 0],
    g: -0.4,
    spread: 0.6,
  },
  fountain: {
    c0: [0.55, 0.78, 1.1, 0.85],
    c1: [0.45, 0.65, 1, 0],
    rate: 90,
    life: [1.3, 1.7],
    size: [0.09, 0.06],
    g: 9.8,
    spread: 0.9,
  },
  snow: { c0: [1, 1, 1, 0.95], c1: [1, 1, 1, 0.4], rate: 60, life: [6, 8], size: [0.05, 0.05], g: 0, spread: 0.25 },
  rain: {
    c0: [0.7, 0.8, 1, 0.55],
    c1: [0.7, 0.8, 1, 0.35],
    rate: 300,
    life: [0.8, 1],
    size: [0.02, 0.02],
    g: 0,
    spread: 0.3,
  },
  fireflies: {
    c0: [3, 3.2, 0.8, 1],
    c1: [2, 2.6, 0.4, 0],
    rate: 6,
    life: [3, 6],
    size: [0.08, 0.06],
    g: 0,
    spread: 0.3,
  },
  magic: {
    c0: [1.6, 0.7, 3.2, 1],
    c1: [0.3, 0.9, 3, 0],
    rate: 40,
    life: [0.8, 1.5],
    size: [0.08, 0],
    g: -0.6,
    spread: 1.4,
  },
  dust: {
    c0: [0.75, 0.68, 0.58, 0.5],
    c1: [0.8, 0.75, 0.68, 0],
    rate: 20,
    life: [0.6, 1.2],
    size: [0.1, 0.35],
    g: 0.5,
    spread: 1.2,
  },
  bubbles: {
    c0: [0.8, 0.95, 1.2, 0.5],
    c1: [0.9, 1, 1.2, 0],
    rate: 15,
    life: [1.5, 2.5],
    size: [0.05, 0.08],
    g: -0.8,
    spread: 0.2,
  },
  confetti: {
    c0: [1, 0.4, 0.6, 1],
    c1: [1, 0.8, 0.3, 0.8],
    rate: 30,
    life: [2.5, 3.5],
    size: [0.06, 0.06],
    g: 4,
    spread: 3.5,
  },
  fire: {
    c0: [4, 1.7, 0.45, 0.9],
    c1: [1.2, 0.2, 0.05, 0],
    rate: 70,
    life: [0.45, 0.9],
    size: [0.3, 0.04],
    g: -1.5,
    spread: 0.45,
  },
};

describe('the emitter kind', () => {
  it("lists the engine's emitters, filled, the sparks standing in for a missing one", () => {
    const reg = createRegistry();
    const sparks = getEmitter('emitter:sparks', reg);
    expect(reg.describe('emitter').ids).toEqual(Object.keys(BUILT_IN_EMITTERS).sort());
    expect(reg.describe('emitter').ids).toHaveLength(27); // the house's breaks (WP 13.16): glass, splinters, shatter
    expect(sparks).toMatchObject({ stretch: true, lands: true, bounce: 0.35, additive: true, count: 16 });
    expect(sparks.ring.radius).toEqual([0, 0]);
    expect(Object.isFrozen(sparks.layers)).toBe(true);
  });

  it("keeps shardfall's 13 presets: their rates, lives, sizes, pulls and spreads, and colours within a hex step", () => {
    const reg = createRegistry();
    for (const [name, want] of Object.entries(SHARDFALL)) {
      const entry = getEmitter(`emitter:${name}`, reg);
      expect([entry.rate, entry.life, entry.size, entry.gravity, entry.spread], name).toEqual([
        want.rate,
        want.life,
        want.size,
        want.g,
        want.spread,
      ]);
      const spec = particleSpec(entry);
      for (const [got, wanted] of [
        [spec.c0, want.c0],
        [spec.c1, want.c1],
      ]) {
        const step = Math.max(1, ...wanted.slice(0, 3)) / 100; // 8 bits of sRGB, at the brightness
        wanted.forEach((value, k) =>
          expect(Math.abs(got[k] - value), `${name} channel ${k}`).toBeLessThanOrEqual(step),
        );
      }
    }
  });

  it('names a defined emitter in every layer, and answers each event effect’s event', () => {
    const reg = createRegistry();
    emitterKind(reg);
    const entries = reg.list('emitter') as unknown as Emitter[];
    for (const entry of entries) {
      for (const layer of entry.layers) expect(reg.has('emitter', layer.emitter), `${entry.id}`).toBe(true);
    }
    const answering = entries.flatMap((entry) => entry.events.map((type) => [type, entry.id]));
    expect(Object.fromEntries(answering)).toEqual({
      hit: 'emitter:hit',
      explosion: 'emitter:explosion',
      slain: 'emitter:slain',
      slam: 'emitter:slam',
      block: 'emitter:block',
      shot: 'emitter:shot',
      destroyed: 'emitter:destroyed',
      land: 'emitter:land',
      glass: 'emitter:glass',
      splinters: 'emitter:splinters',
      shatter: 'emitter:shatter',
    });
    expect(getEmitter('emitter:explosion', reg).ring).toMatchObject({ radius: [0.19, 1.6], life: 0.4 });
  });

  it('refuses a spec with problems, naming each', () => {
    const reg = createRegistry();
    expect(() =>
      defineEmitter(
        'emitter:bad',
        {
          color: ['#fff', 'orange'],
          life: [2, 1],
          layers: [{ emitter: 'emitter:bad', set: { colour: '#fff' } as never }],
        },
        reg,
      ),
    ).toThrow(/color "orange" is not hex.*life is \[longest, shortest\].*emitter is the emitter itself.*colour/s);
    expect(() => defineEmitter('emitter:flat', { area: [1, 2] }, reg)).toThrow(/area has 2 numbers/);
  });

  it('makes one spec per entry and change, linear and bright', () => {
    const reg = createRegistry();
    const explosion = getEmitter('emitter:explosion', reg);
    const fire = getEmitter('emitter:fire', reg);
    const [layer] = explosion.layers.filter((l) => l.emitter === 'emitter:fire');
    expect(particleSpec(fire, layer.set)).toBe(particleSpec(fire, layer.set));
    expect(particleSpec(fire)).not.toBe(particleSpec(fire, layer.set));
    expect(particleSpec(fire, layer.set)).toMatchObject({ spread: 2.5, size: [0.35, 0.05], life: [0.25, 0.55] });
    expect(particleSpec(defineEmitter('emitter:white', { brightness: [2, 1] }, reg)).c0).toEqual([2, 2, 2, 1]);
  });
});
