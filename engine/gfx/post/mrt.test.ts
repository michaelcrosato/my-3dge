/**
 * @file Unit tests for the fixed MRT's flags (engine/gfx/post/mrt.ts): packing round-trips for every part, group and
 * pixel-art flag within a half float's exact integers, the parts objects are drawn as, tagged or not, and the flag
 * table: a slot per drawable object for life, its flags as they are at each write.
 */
import { Group, Line, Mesh, Object3D, Scene, type Vector4 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createFlagTable, flagsOf, foldGroup, GROUPS, packFlags, PARTS, setPart, unpackFlags } from './mrt';

describe('packFlags and unpackFlags', () => {
  it('round-trip every part, group and pixel-art flag, within ±2,047', () => {
    for (const part of PARTS) {
      for (const group of [1, 2, 255, 510, GROUPS]) {
        for (const pixelArt of [false, true]) {
          const w = packFlags(part, group, pixelArt);
          expect(Math.abs(w)).toBeLessThanOrEqual(2047);
          expect(Number.isInteger(w)).toBe(true);
          expect(unpackFlags(w)).toEqual({ part, group, pixelArt });
        }
      }
    }
  });

  it("packs as shardfall does, with the characters' 512 bit", () => {
    expect(packFlags('environment', 7, false)).toBe(7);
    expect(packFlags('object', 7, false)).toBe(1031);
    expect(packFlags('character', 7, true)).toBe(-1543);
  });

  it('folds groups into 1..511 and reads the cleared background (w = 1) as the environment', () => {
    expect([foldGroup(0), foldGroup(1), foldGroup(511), foldGroup(512), foldGroup(1023)]).toEqual([0, 1, 511, 1, 1]);
    expect(packFlags('object', 0, false)).toBe(1025);
    expect(unpackFlags(1).part).toBe('environment');
  });
});

describe('flagsOf', () => {
  it('reads a tag on the object or its nearest tagged ancestor', () => {
    const root = setPart(new Group(), 'object', { group: 40 });
    const mesh = new Mesh();
    root.add(mesh);
    expect(flagsOf(mesh)).toEqual({ part: 'object', group: 40, pixelArt: false });
    setPart(mesh, 'character', { pixelArt: true });
    expect(flagsOf(mesh)).toEqual({ part: 'character', group: foldGroup(mesh.id), pixelArt: true });
  });

  it('counts puppets and the protagonist as characters, entities as objects, the rest as the environment', () => {
    const puppet = new Group();
    puppet.userData.body = 'body:hero';
    const piece = new Mesh();
    puppet.add(piece);
    expect(flagsOf(piece).part).toBe('character');
    const hero = new Mesh();
    hero.userData.protagonist = true;
    expect(flagsOf(hero).part).toBe('character');
    const crate = new Mesh();
    crate.userData.entity = 12;
    expect(flagsOf(crate)).toEqual({ part: 'object', group: 12, pixelArt: false });
    expect(flagsOf(new Object3D())).toEqual({ part: 'environment', group: 1, pixelArt: false });
  });
});

describe('the flag table', () => {
  /** The value at `slot` of `table`. */
  const at = (table: ReturnType<typeof createFlagTable>, slot: number) =>
    (table.node.array[slot >> 2] as Vector4).getComponent(slot & 3);

  it('gives each drawable object a slot for life and writes its flags as they are at each write', () => {
    const table = createFlagTable();
    const scene = new Scene();
    const hero = setPart(new Mesh(), 'character');
    const crate = new Mesh();
    crate.userData.entity = 12;
    const rope = new Line();
    const holder = new Group();
    holder.add(crate);
    scene.add(hero, holder, rope);
    expect(table.write(scene)).toBe(0);
    const slots = [hero, crate, rope].map((object) => table.slotOf(object));
    expect(new Set(slots).size).toBe(3);
    expect(slots.every((slot) => slot > 0)).toBe(true);
    expect(at(table, slots[0])).toBe(packFlags('character', hero.id, false));
    expect(at(table, slots[1])).toBe(packFlags('object', 12, false));
    expect(at(table, slots[2])).toBe(packFlags('environment', 1, false));
    expect(at(table, 0), 'slot 0 is the environment').toBe(packFlags('environment', 1, false));

    // A tag changed after the first frame reaches the table at the next write, the slot unchanged.
    setPart(hero, 'character', { pixelArt: true });
    setPart(holder, 'environment');
    table.write(scene);
    expect(table.slotOf(hero)).toBe(slots[0]);
    expect(at(table, slots[0])).toBe(packFlags('character', hero.id, true));
    expect(at(table, slots[1])).toBe(packFlags('environment', 12, false));
  });
});
