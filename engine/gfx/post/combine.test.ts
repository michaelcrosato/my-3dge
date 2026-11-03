/**
 * @file Unit tests for combining looks (engine/gfx/post/combine.ts): a filter laid on at an amount (fading in where the
 * chain has it off; numbers, whole numbers, colours and choices blended where it is on), only some filters of a layer,
 * a look's strength, looks built on looks with changes to a layer's filters, the look's own filters over its layers,
 * and a cycle skipped with its advice.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { combineChain, layChain, layFilter, strengthen, type CombineWarn } from './combine';
import { chainOf, FILTER_NAMES } from './filters';
import { defineLook, defineLooks, type LookEntry } from './looks';

/** A registry with the engine's looks and three of the test's, and the advice it gave. */
function setup() {
  const registry = createRegistry();
  defineLooks(registry);
  defineLook('look:test-warm', { description: 'Warm.', filters: { grade: { scope: 'all', temperature: 0.4, contrast: 0.2 }, vignette: { scope: 'all', strength: 0.6 } } }, registry); // prettier-ignore
  defineLook('look:test-mixed', { description: 'Half warm, the vignette only, a cel on top.', combine: [{ look: 'look:test-warm', amount: 0.5, only: ['vignette'] }], filters: { cel: { scope: 'characters', bands: 3 } } }, registry); // prettier-ignore
  defineLook('look:test-loop-a', { description: 'Lays B on.', combine: [{ look: 'look:test-loop-b' }], filters: { grain: { scope: 'all' } } }, registry); // prettier-ignore
  defineLook('look:test-loop-b', { description: 'Lays A on.', combine: [{ look: 'look:test-loop-a' }], filters: { chroma: { scope: 'all' } } }, registry); // prettier-ignore
  const warned: string[] = [];
  const warn: CombineWarn = (code, data) => void warned.push(`${code}: ${data.through}`);
  const look = (id: string) => registry.get('look', id) as LookEntry;
  return { registry, warned, warn, look };
}

describe('laying a filter on', () => {
  it('fades it in where the chain has it off, its amount times the layer’s', () => {
    const on = chainOf({ grade: { scope: 'all', saturation: 0.5, amount: 0.8 } }).grade;
    const laid = layFilter('grade', chainOf().grade, on, 0.25);
    expect(laid).toEqual({ ...on, amount: 0.2 });
    expect(layFilter('grade', chainOf().grade, on, 0)).toEqual(chainOf().grade);
  });

  it('blends where both have it on: numbers move, whole numbers round, colours mix, choices switch at 0.5', () => {
    const a = chainOf({ pixel: { scope: 'all', size: 4 }, duotone: { scope: 'all', dark: '#000000' } });
    const b = chainOf({ pixel: { scope: 'characters', size: 7 }, duotone: { scope: 'all', dark: '#ffffff' } });
    const quarter = layChain(a, b, 0.25);
    expect([quarter.pixel.size, quarter.pixel.scope]).toEqual([5, 'all']); // 4.75 rounds to 5
    expect(layChain(a, b, 0.5).pixel.scope).toBe('characters');
    // half of white in linear light is 0.5, about 188 in sRGB: lighter than the sRGB midpoint 128
    expect(layChain(a, b, 0.5).duotone.dark).toBe('#bcbcbc');
    expect(layChain(a, b, 1).duotone.dark).toBe('#ffffff');
  });

  it('never turns a filter off, and lays only the filters `only` names', () => {
    const base = chainOf({ grade: { scope: 'all', saturation: 0 } });
    expect(layChain(base, chainOf(), 1).grade).toEqual(base.grade);
    const layer = chainOf({ grade: { scope: 'all', saturation: 2 }, vignette: { scope: 'all' } });
    const picked = layChain(base, layer, 1, ['vignette']);
    expect([picked.grade.saturation, picked.vignette.scope]).toEqual([0, 'all']);
  });
});

describe("a look's strength", () => {
  it('scales the amount of every filter that is on, and is the chain itself at 1', () => {
    const chain = chainOf({ grade: { scope: 'all' }, cel: { scope: 'objects', amount: 0.5 } });
    expect(strengthen(chain, 1)).toBe(chain);
    const half = strengthen(chain, 0.5);
    expect([half.grade.amount, half.cel.amount, half.pixel.amount]).toEqual([0.5, 0.25, 1]);
  });
});

describe('combining looks', () => {
  it('gives a look with no layers at strength 1 its own chain, the same object', () => {
    const { registry, warn, look } = setup();
    expect(combineChain(look('look:test-warm'), registry, warn)).toBe(look('look:test-warm').filters);
  });

  it("lays its layers in order, only the filters each names, then the look's own filters that are on", () => {
    const { registry, warn, warned, look } = setup();
    const chain = combineChain(look('look:test-mixed'), registry, warn);
    expect([chain.vignette.scope, chain.vignette.amount, chain.vignette.strength]).toEqual(['all', 0.5, 0.6]);
    expect(chain.grade.scope, 'not in only').toBe('off');
    expect([chain.cel.scope, chain.cel.bands]).toEqual(['characters', 3]);
    expect(warned).toEqual([]);
  });

  it("changes a layer's filters field by field before it is laid on, and scales it all by the look's strength", () => {
    const { registry, warn } = setup();
    const id = 'look:test-cooler';
    defineLook(id, { description: 'Warm, less so.', strength: 0.5, combine: [{ look: 'look:test-warm', filters: { grade: { temperature: 0.1 } } }] }, registry); // prettier-ignore
    const chain = combineChain(registry.get('look', id) as LookEntry, registry, warn);
    expect([chain.grade.temperature, chain.grade.contrast, chain.grade.amount]).toEqual([0.1, 0.2, 0.5]);
    expect(FILTER_NAMES.filter((name) => chain[name].scope !== 'off')).toEqual(['grade', 'vignette']);
  });

  it('skips a layer that leads back to a look being combined, with its advice, and keeps the rest', () => {
    const { registry, warn, warned, look } = setup();
    const chain = combineChain(look('look:test-loop-a'), registry, warn);
    expect([chain.grain.scope, chain.chroma.scope]).toEqual(['all', 'all']);
    expect(warned).toEqual(['GFX_LOOK_COMBINE_LOOP: look:test-loop-a → look:test-loop-b → look:test-loop-a']);
  });

  it('refuses a look that lays itself on, naming the layer', () => {
    const { registry } = setup();
    expect(() => defineLook('look:test-self', { combine: [{ look: 'look:test-self' }] }, registry)).toThrow(
      /combine\[0\] lays look:test-self on itself/,
    );
  });
});
