/**
 * @file Unit tests for the props drawn (engine/gfx/props.ts), in Node: the props' texture and materials are defined
 * and pass the tex checks; every prop part gets a batch; a prop's mesh is drawn where its pose puts it, the body's
 * centre `propCentre` above the base, turned with it; the barrel's lids are a draw group of their own; the fire's
 * tongues dance on time and on a phase drawn from the visual stream, the same for equal streams; the lights stand
 * where the prop's light spot is and flicker; a prop that is off draws its lit parts dimmed and gives no light; the
 * warm-up sees every batch, later ones included.
 * @see engine/gfx/props.ts
 * @see tests/e2e/props.spec.ts
 */
import { Color, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { RngStreams } from '../core/rng';
import { checkTextures } from '../../tools/qa/tex';
import { defineProp, type Prop } from '../world/props/prop';
import { createMaterialLibrary } from './materials/library';
import { bakeTexture } from './textures/bake';
import { createPropMeshes, FLICKER, OFF, type PropMeshesOptions } from './props';

/** Prop meshes over a fresh registry, with its material library. */
function meshes(options: Partial<PropMeshesOptions> = {}) {
  const registry = options.registry ?? createRegistry();
  const props = createPropMeshes({ materials: createMaterialLibrary({ registry }), registry, ...options });
  return { registry, props };
}

/** The matrix in slot `slot` of the batch named `name`. */
function slotOf(props: ReturnType<typeof meshes>['props'], name: string, slot = 0): Matrix4 {
  return props
    .batches()
    .find((batch) => batch.name === name)!
    .getMatrixAt(slot, new Matrix4());
}

/** Whether `a` and `b` agree to float32 precision. */
const near = (a: Matrix4, b: Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5);

describe('the props drawn', () => {
  it("defines the props' texture and materials, the crate's face tiling cleanly", () => {
    const { registry } = meshes();
    for (const id of [
      'material:crate',
      'material:barrelStaves',
      'material:barrelLid',
      'material:flame',
      'material:iron',
      'material:cloth',
      'material:pane',
      'material:paint',
    ]) {
      // prettier-ignore
      expect(registry.has('material', id), id).toBe(true);
    }
    expect(checkTextures(registry, ['texture:crate'])).toEqual([]);
    const bake = bakeTexture('texture:crate', registry);
    expect([bake.width, bake.height]).toEqual([12, 12]);
    const at = (x: number, y: number) => Array.from(bake.map.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 3));
    expect(at(1, 1)).toEqual([0x2e, 0x24, 0x20]); // a nail in each corner of the frame
    expect(at(0, 5)).toEqual([0x4a, 0x2e, 0x1c]); // the dark edge
    expect(at(5, 5)).toEqual([0xc0, 0x8a, 0x55]); // the brace
  });

  it('makes a batch per prop part and draws a prop where its body is, its base propCentre below', () => {
    const { props, registry } = meshes();
    // One a part of every prop, in id order: the catalog's (WP 4.5) among the library's (WP 10.3; its chair, WP 13.16,
    // a seat, two sides and a back) and the fittings' (WP 13.16: the pane's glass, the switch's plate and rocker, the
    // lamp's cord, shade and bulb, the garage door's panels and three seams).
    const parts = (registry.list('prop') as unknown as Prop[]).flatMap((prop) => prop.parts.map((part) => `${prop.id}/${part.name}`)); // prettier-ignore
    expect(props.batches().map((batch) => batch.name)).toEqual(parts);
    expect(parts.length).toBe(55);
    expect(parts.filter((name) => /^prop:(barrel|brazier|crate|pillar)\//.test(name))).toEqual(['prop:barrel/mesh', 'prop:brazier/flames', 'prop:crate/mesh', 'prop:pillar/mesh']); // prettier-ignore
    const position = new Vector3(2, 1.1, -3);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 0.5).normalize(), 0.8);
    props.begin(0);
    props.add('prop:crate', { position, rotation });
    props.add('prop:crate', { position: [5, 0.375, 1], rotation: [0, 0, 0, 1] });
    props.end();
    const body = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
    expect(near(slotOf(props, 'prop:crate/mesh'), body.multiply(new Matrix4().makeTranslation(0, -0.375, 0)))).toBe(
      true,
    );
    expect(near(slotOf(props, 'prop:crate/mesh', 1), new Matrix4().makeTranslation(5, 0, 1))).toBe(true);
    // Shown: the crates and their shadow; the barrel's sides and lids would be two groups, each in each pass.
    expect(props.drawCalls(1)).toBe(2);
    props.begin(0);
    props.add('prop:barrel', { position: [0, 0.4375, 0] });
    props.end();
    expect(props.drawCalls(1)).toBe(4);
    expect(props.batches().find((batch) => batch.name === 'prop:crate/mesh')!.count).toBe(0);
    props.dispose();
    expect(props.batches()).toEqual([]);
  });

  it('dances the flames on time and on a phase from the visual stream, the same for equal streams', () => {
    const draw = (time: number, key: number, seed = 1) => {
      const streams = new RngStreams(seed);
      const { props } = meshes({ fxRng: (...keys) => streams.stream(...keys), props: ['prop:brazier'] });
      props.begin(time);
      props.add('prop:brazier', { position: [4, 0.75, 2] }, key);
      props.end();
      const batch = props.batches()[0];
      const slots = Array.from({ length: batch.count }, (_, i) => batch.getMatrixAt(i, new Matrix4()));
      const colour = batch.pages[0].instanceColor!.array.slice(0, 6);
      return { slots, colour, lights: props.lights() };
    };
    const first = draw(1, 7);
    expect(first.slots).toHaveLength(6);
    expect(draw(1, 7).slots.every((m, i) => near(m, first.slots[i]))).toBe(true);
    expect(draw(1.1, 7).slots.some((m, i) => !near(m, first.slots[i]))).toBe(true);
    expect(draw(1, 8).slots.some((m, i) => !near(m, first.slots[i]))).toBe(true);
    expect(draw(1, 7, 2).slots.some((m, i) => !near(m, first.slots[i]))).toBe(true);
    // Each tongue is its tint round a core of flame.core; both rise from the coals, 1/12 of the stand below the base.
    const [outer, core] = [new Color('#ff7a2a'), new Color('#ffd36a')];
    expect(Array.from(first.colour).map((v) => +v.toFixed(5))).toEqual(
      [outer.r, outer.g, outer.b, core.r, core.g, core.b].map((v) => +v.toFixed(5)),
    );
    for (const slot of first.slots) {
      const at = new Vector3().setFromMatrixPosition(slot);
      expect(at.y).toBeCloseTo(0.6875, 6);
      expect(Math.hypot(at.x - 4, at.z - 2)).toBeLessThan(0.1 + 0.0875 * 0.5 + 1e-6);
    }
    // The torch shines 0.25 m above the base, its intensity flickering about 30.
    const [light] = first.lights;
    expect(light).toMatchObject({ prop: 'prop:brazier', tag: 'torch', color: '#ffc8a0', distance: 10.625, decay: 0.5 });
    expect(light.position.map((v) => +v.toFixed(6))).toEqual([4, 1, 2]);
    expect(light.intensity).toBeGreaterThan(30 * 0.77);
    expect(light.intensity).toBeLessThan(30 * 1.03);
    expect(draw(1.5, 7).lights[0].intensity).not.toBe(light.intensity);
  });

  it('draws a prop that is off with its lit parts dimmed and no light: a lamp its switch turned off', () => {
    const { props } = meshes();
    const tints: number[][] = [];
    const bulb = props.batches().find((batch) => batch.name === 'prop:lamp/bulb')!;
    const add = bulb.add.bind(bulb);
    bulb.add = (matrix, color, offset) => (tints.push((color as Color).toArray()), add(matrix, color, offset));
    const lights = [true, false].map((on) => {
      props.begin(0);
      props.add('prop:lamp', { position: [0, 2.6, 0], on });
      props.end();
      return props.lights().map((light) => light.tag);
    });
    expect(lights).toEqual([['lamp'], []]);
    expect(tints[1].map((v, k) => v / tints[0][k])).toEqual([OFF, OFF, OFF].map((v) => expect.closeTo(v, 6)));
  });

  it("flickers as the 2D hall's flames do", () => {
    expect(FLICKER(0)).toBe(0.9);
    const samples = Array.from({ length: 2000 }, (_, i) => FLICKER(i * 0.013));
    expect(Math.min(...samples)).toBeGreaterThan(0.77);
    expect(Math.max(...samples)).toBeLessThan(1.03);
  });

  it('registers every batch with the warm-up, and a prop defined later when it is first drawn', () => {
    const registry = createRegistry();
    const { props } = meshes({ registry, props: ['prop:crate'] });
    const ids: string[] = [];
    const warmup = { register: (id: string) => (ids.push(id), { dispose: () => ids.splice(ids.indexOf(id), 1) }) };
    const registration = props.register(warmup);
    expect(ids).toEqual(['batch:prop:crate/mesh']);
    defineProp('prop:stool', { parts: [{ name: 'seat', geometry: 'geometry:frustum' }] }, registry);
    props.begin(0);
    props.add('prop:stool', { position: [0, 0, 0] });
    props.end();
    expect(ids).toEqual(['batch:prop:crate/mesh', 'batch:prop:stool/seat']);
    registration.dispose();
    expect(ids).toEqual([]);
  });
});
