/**
 * @file Unit tests for the generator registry (engine/gfx/textures/texture.ts): a registry gets the kind with the
 * six v1 generators; `defineTexture` stores a generator and refuses parameters without a description or default, a
 * size that does not tile and duplicate ids; parameters are filled and checked by their schema; sizes are checked
 * against the tile with `GFX_TEXTURE_SIZE`, naming a size that fits.
 * @see engine/gfx/textures/texture.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { assertSize, defineTexture, getTexture, sizeProblem, textureParams } from './texture';

/** A small valid generator: two-texel stripes. */
const stripes = {
  description: 'Two-texel stripes.',
  params: { light: { type: 'integer', default: 192, minimum: 0, maximum: 255, description: 'The light stripes.' } },
  size: [8, 8] as [number, number],
  tile: () => [4, 1] as [number, number],
  create:
    ({ params }: { params: { light: number } }) =>
    (x: number, y: number, texel: { color: number[] }) =>
      void texel.color.fill(x % 4 < 2 ? params.light : 64),
} as const;

describe('the texture kind', () => {
  it('comes with the v1 generators', () => {
    const reg = createRegistry();
    getTexture('texture:brick', reg);
    expect(reg.list('texture').map((entry) => entry.id)).toEqual([
      'texture:brick',
      'texture:checker',
      'texture:flagstone',
      'texture:planks',
      'texture:staves',
      'texture:stone',
    ]);
    expect(reg.describe('texture').fields.map((field) => field.key)).toEqual([
      'description',
      'params',
      'size',
      'tile',
      'density',
      'look',
      'create',
    ]);
  });

  it('defines a generator with its defaults filled', () => {
    const reg = createRegistry();
    const entry = defineTexture('texture:stripes', stripes as never, reg);
    expect(entry).toMatchObject({ id: 'texture:stripes', size: [8, 8], density: 16, look: 'pixel' });
    expect(textureParams(entry)).toEqual({ light: 192 });
    expect(textureParams(entry, { light: 200 })).toEqual({ light: 200 });
  });

  it('refuses a parameter without a description or a default, and names it', () => {
    const reg = createRegistry();
    const bad = {
      ...stripes,
      params: { light: { type: 'integer', description: 'No default.' }, dark: { type: 'integer', default: 1 } },
    };
    expect(() => defineTexture('texture:bad', bad as never, reg)).toThrow(
      /params\.light needs a default.*params\.dark: it needs a description/,
    );
  });

  it('refuses a default size that is not a whole number of tiles', () => {
    const reg = createRegistry();
    expect(() => defineTexture('texture:odd', { ...stripes, size: [10, 8] } as never, reg)).toThrow(
      /size \[10, 8\] does not tile: its pattern repeats every 4 × 1 texels/,
    );
  });

  it('refuses a second definition of an id', () => {
    const reg = createRegistry();
    defineTexture('texture:stripes', stripes as never, reg);
    expect(() => defineTexture('texture:stripes', stripes as never, reg)).toThrow(
      expect.objectContaining({ code: 'CORE_DUPLICATE_ID' }),
    );
  });

  it('checks parameters by their schema, naming the closest key', () => {
    const entry = getTexture('texture:brick', createRegistry());
    expect(() => textureParams(entry, { widht: 9 })).toThrow(/unknown key "widht" \(did you mean "width"\?\)/);
    expect(() => textureParams(entry, { course: 1 })).toThrow(/course is 1, below its minimum 3/);
  });

  it('checks a size against the tile, naming a size that fits', () => {
    const entry = getTexture('texture:brick', createRegistry());
    const params = textureParams(entry);
    expect(sizeProblem(entry, params, [64, 64])).toBe('');
    expect(sizeProblem(entry, params, [64, 60])).toBe('its pattern repeats every 8 × 8 texels with these parameters');
    expect(sizeProblem(entry, params, [1, 64])).toMatch(/whole numbers of texels from 2 to 4096/);
    expect(() => assertSize(entry, params, [60, 64])).toThrow(
      expect.objectContaining({ code: 'GFX_TEXTURE_SIZE', message: expect.stringMatching(/size: \[64, 64\] fits/) }),
    );
  });
});
