/**
 * @file Unit tests for the props library (engine/world/props/library.ts; WP 10.3), in Node: every registry gets the
 * nine, filled; the dynamic ones weigh what their descriptions say and stand on spawn points of their names, the
 * fixed ones never move, the door is kinematic (WP 13.16 swings it on its hinge), the sconce has no body; the sconce's and the lantern's lights flicker under their own tags,
 * the others have none; a hit knocks the dynamic ones and leaves the rest; placed and turned, a body stands its centre
 * half its height over its base.
 * @see engine/world/props/library.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { LIBRARY_PROPS } from './library';
import { propBody } from './place';
import { getProp, propCentre, type Prop, type PropKnock } from './prop';

const registry = createRegistry();
const PROPS = Object.keys(LIBRARY_PROPS).map((id) => getProp(id, registry));
/** A box body's volume (m³). */
const volume = ({ body: { size } }: Prop) => size[0] * size[1] * size[2];

describe('the props library', () => {
  it('weighs the dynamic props as their descriptions say, on spawn points of their names; fixes the others but the door', () => {
    const rows = PROPS.map((prop) => [prop.id, prop.body.type, prop.place.spawn, prop.body.type === 'dynamic' ? Math.round(prop.body.density * volume(prop)) : null]); // prettier-ignore
    expect(rows).toEqual([
      ['prop:sconce', 'none', '', null],
      ['prop:banner', 'fixed', 'banner', null],
      ['prop:chest', 'dynamic', 'chest', 40],
      ['prop:door', 'kinematic', '', null], // WP 13.16: the sim swings it on its hinge
      ['prop:table', 'dynamic', 'table', 30],
      ['prop:bench', 'dynamic', 'bench', 15],
      ['prop:statue', 'fixed', 'statue', null],
      ['prop:lantern', 'dynamic', 'lantern', 2],
      ['prop:chair', 'dynamic', 'chair', 6], // WP 13.16: the pickup the playtest throws
    ]);
    expect(PROPS.every((prop) => prop.description.length > 0 && prop.parts.length >= 3)).toBe(true);
  });

  it('lights the sconce and the lantern, flickering under their own tags; the others have none', () => {
    const lights = PROPS.filter((prop) => prop.light.tag !== '').map((prop) => [prop.id, prop.light.tag, prop.light.flicker]); // prettier-ignore
    expect(lights).toEqual([
      ['prop:sconce', 'sconce', true],
      ['prop:lantern', 'lantern', true],
    ]);
    expect(getProp('prop:sconce', registry).parts.find((part) => part.name === 'flames')!.flame.tongues).toBe(3);
  });

  it('knocks the dynamic props on a hit and leaves the others', () => {
    const knocked = PROPS.filter((prop) => {
      const knocks: (PropKnock | undefined)[] = [];
      prop.hit({ prop, body: 1, from: [-1, 0, 0], knock: (options) => void knocks.push(options) });
      prop.use({ prop, body: 1, from: [-1, 0, 0], knock: (options) => void knocks.push(options) }); // nothing yet
      return knocks.length > 0;
    });
    expect(knocked.map((prop) => prop.id)).toEqual(['prop:chest', 'prop:table', 'prop:bench', 'prop:lantern', 'prop:chair']); // prettier-ignore
  });

  it('stands a body’s centre half its height over its base where it is placed, turned with it', () => {
    const door = propBody({ prop: 'prop:door', at: [1, 0, 2], yaw: Math.PI / 2 }, registry)!;
    expect([door.type, door.position, propCentre(getProp('prop:door', registry))]).toEqual(['kinematic', [1, 1.025, 2], 1.025]); // prettier-ignore
    expect(door.rotation!.map((v) => +v.toFixed(6))).toEqual([0, +Math.SQRT1_2.toFixed(6), 0, +Math.SQRT1_2.toFixed(6)]); // prettier-ignore
    expect(door.colliders[0].shape).toEqual({ type: 'box', size: [0.9, 2.05, 0.045] });
    expect(propBody({ prop: 'prop:sconce', at: [0, 1.4, 0], yaw: 0 }, registry)).toBeNull();
  });
});
