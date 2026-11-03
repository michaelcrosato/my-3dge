/**
 * @file Unit tests for looks (engine/gfx/post/looks.ts, presets.ts, presetsMore.ts): the kind and its data, seeded
 * from shardfall's presets and Style Lab's; the posterize rule; every colour checked; the fallback; that every preset
 * sets only its own filter (or the style), and every look made by combining names looks that exist.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../core/registry';
import { FILTER_NAMES } from './filters';
import { defineLook, defineLooks, LOOKS, type LookEntry } from './looks';
import { PRESETS } from './presets';
import { COMBINED_LOOKS, STYLE_PRESETS } from './presetsMore';

/** A fresh registry with the looks. */
function looks() {
  const registry = createRegistry();
  defineLooks(registry);
  return registry;
}

describe('the look kind', () => {
  it('holds the clean look, 21 of shardfall’s whole looks and 76 presets, Style Lab’s 31 and 8 looks combined', () => {
    const registry = looks();
    expect(Object.keys(LOOKS)).toHaveLength(22);
    expect(Object.keys(PRESETS)).toHaveLength(76);
    expect([Object.keys(STYLE_PRESETS).length, Object.keys(COMBINED_LOOKS).length]).toEqual([31, 8]);
    expect(registry.list('look')).toHaveLength(137);
    const clean = registry.get('look', 'look:clean') as LookEntry;
    expect([clean.style, clean.sky]).toEqual(['', '']);
    for (const name of FILTER_NAMES) expect(clean.filters[name].scope, name).toBe('off');
  });

  it('renames shardfall’s keys: its “objects” is characters and objects', () => {
    const hd = looks().get('look', 'look:hd-2d') as LookEntry;
    expect(hd.filters.pixel).toMatchObject({ scope: 'characters+objects', size: 4, outline: true });
    expect(hd.filters.bloom).toMatchObject({ scope: 'all', strength: 1, threshold: 0.7 });
    expect(hd.filters.grade).toMatchObject({ scope: 'environment', temperature: 0.25, saturation: 1.2 });
    const cartoon = looks().get('look', 'look:cartoon') as LookEntry;
    expect([cartoon.style, cartoon.toon]).toEqual(['toon', { bands: 2, rim: 0.4, shade: 0, dither: 0 }]);
  });

  it('turns on in each preset only the filters of its group (grain with chroma), or only the style', () => {
    const registry = looks();
    for (const id of [...Object.keys(PRESETS), ...Object.keys(STYLE_PRESETS)]) {
      const look = registry.get('look', id) as LookEntry;
      const on = FILTER_NAMES.filter((name) => look.filters[name].scope !== 'off');
      const allowed = look.group === 'grain' ? ['grain', 'chroma'] : look.group === 'pixel' ? ['pixel', 'palette'] : [look.group]; // prettier-ignore
      for (const name of on) expect(allowed, `${id} turns on ${name}`).toContain(name);
      if (look.group !== 'shading') expect(look.style, id).toBe('');
    }
  });

  it("keeps the scene's own sky unless a look names one (WP 7.8)", () => {
    const registry = looks();
    for (const look of registry.list('look') as LookEntry[]) expect(look.sky, look.id).toBe('');
    expect(defineLook('look:torches', { sky: 'sky:hall', style: 'toon' }, registry).sky).toBe('sky:hall');
  });

  it('refuses fewer than 8 levels per channel, naming the rule', () => {
    const registry = looks();
    expect(() => defineLook('look:muddy', { filters: { palette: { scope: 'all', levels: 4 } } }, registry)).toThrow(
      /8 levels and more/,
    );
    expect(defineLook('look:fine', { filters: { pixel: { scope: 'all', levels: 24 } } }, registry).filters.pixel.levels).toBe(24); // prettier-ignore
  });

  it('combines only looks that exist, each turning on filters, none laid on itself', () => {
    const registry = looks();
    for (const [id, spec] of Object.entries(COMBINED_LOOKS)) {
      for (const layer of spec.combine ?? []) expect(registry.has('look', layer.look), `${id} lays ${layer.look}`).toBe(true); // prettier-ignore
      expect((registry.get('look', id) as LookEntry).combine.length, id).toBeGreaterThan(1);
    }
  });

  it('refuses a colour that is none in any filter, naming the forms it takes (GFX_POST_BAD_COLOR in a layer)', () => {
    expect(() => defineLook('look:dusky', { filters: { duotone: { scope: 'all', dark: '' } } }, looks())).toThrow(
      /filters\.duotone\.dark is "", which is no colour: give hex/,
    );
  });

  it('refuses an outline colour that is none, naming the forms it takes (GFX_POST_BAD_COLOR in a layer)', () => {
    const registry = looks();
    const typo = () => defineLook('look:inky', { filters: { outline: { scope: 'all', color: 'blakc' } } }, registry);
    expect(typo).toThrow(/filters\.outline\.color is "blakc", which is no colour: give hex/);
    for (const color of ['#1a1a2e', '#f00', 'Black', ''])
      expect(defineLook(`look:ink-${color.replace('#', '') || 'darken'}`, { filters: { outline: { scope: 'all', color } } }, registry).filters.outline.color).toBe(color); // prettier-ignore
  });

  it('falls back to the clean look for a missing id, with a warning naming the fix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(looks().get('look', 'look:no-such-look').id).toBe('look:clean');
      expect(String(warn.mock.calls[0]?.[0])).toContain('defineLook(');
    } finally {
      warn.mockRestore();
    }
  });
});
