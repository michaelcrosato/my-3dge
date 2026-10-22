/**
 * @file Unit tests for the `gallery` field (engine/core/gallery.ts; WP 7.7): its defaults are the kind's, `parse`
 * fills an entry's partial field, a negative duration is a problem; the engine's six kinds that need review have it,
 * found from their schemas, and a kind declared with it joins them.
 * @see engine/core/gallery.ts
 */
import { describe, expect, it } from 'vitest';
import '../anim/moves-data';
import '../gfx/fx/emitters';
import '../gfx/materials/material';
import '../gfx/post/looks';
import '../gfx/puppets/grammar';
import '../world/props/prop';
import { galleryField, galleryKinds } from './gallery';
import { createRegistry, registry } from './registry';
import { parse, validate } from './schema';

describe('the gallery field', () => {
  it('takes the kind’s defaults, and fills what an entry leaves out', () => {
    const fields = { gallery: galleryField({ camera: 'turntable' }) };
    expect(fields.gallery.default).toEqual({ camera: 'turntable', duration: 0, states: [] });
    expect(parse(fields, {}).gallery).toEqual({ camera: 'turntable', duration: 0, states: [] });
    expect(parse(fields, { gallery: { duration: 2 } }).gallery).toEqual({ camera: 'turntable', duration: 2, states: [] }); // prettier-ignore
    expect(validate(fields, { gallery: { duration: -1 } }).problems.map((p) => p.message)).toEqual([
      'gallery.duration is -1, below its minimum 0',
    ]);
  });

  it('is on the six kinds that need review, found from their schemas; a kind declared with it joins', () => {
    expect(galleryKinds(registry)).toEqual(['body', 'emitter', 'look', 'material', 'move', 'prop']);
    const own = createRegistry();
    own.defineKind('banner', { description: 'Banners.', fields: { gallery: galleryField() } });
    own.defineKind('note', { description: 'Notes.', fields: {} });
    expect(galleryKinds(own)).toEqual(['banner']);
  });
});
