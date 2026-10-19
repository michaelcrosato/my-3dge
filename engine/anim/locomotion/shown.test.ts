/**
 * @file Unit tests for the view's movement poses (engine/anim/locomotion/shown.ts, WP 13.10): a body that shows
 * nothing poses as before; the slide seats the body low, the right leg out ahead, the left hand by the floor and over
 * it; the fall reaches the legs down and raises the arms; the hard landing drops the pelvis deep and puts the right
 * hand on the floor ahead; the lean tips the spine.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { Animator } from '../character';
import { jointPosition, tipPosition } from '../fk';
import { getBuild } from '../builds';
import { pelvisTarget, restContext, spineDirection } from '../locomotion';
import { createShown, SHOWN, SHOWN_FOOT_LAYERS, SHOWN_HAND_LAYERS, type ShownMovement } from './shown';

/** The adult posed after 40 ticks standing, showing `shown`, in the air or not. */
function posed(shown: Partial<ShownMovement>, air = false) {
  const hero = new Animator({ build: 'build:adult', clock: 1 });
  for (let i = 0; i < 40; i++) {
    Object.assign(hero.body.shown, createShown(), shown);
    hero.update({ air, position: new Vector3() });
  }
  return hero;
}

describe('the view’s movement poses', () => {
  it('weigh nothing on a body that shows nothing', () => {
    const ctx = restContext(getBuild('build:adult'));
    for (const layer of [...SHOWN_FOOT_LAYERS, ...SHOWN_HAND_LAYERS]) {
      expect([layer.name, layer.weight(ctx, 'L'), layer.weight(ctx, 'R')]).toEqual([layer.name, 0, 0]);
    }
    const still = posed({});
    expect(still.body.pose.toArray()).toEqual(posed({}).body.pose.toArray());
  });

  it('slide: seated low and leaned back, the right leg out ahead, the left hand by the floor', () => {
    const [stand, slide] = [posed({}), posed({ crouch: 1, slide: 1 })];
    expect(slide.socket('contactR').z - stand.socket('contactR').z).toBeGreaterThan(0.3);
    expect(slide.socket('weaponL').y).toBeLessThan(jointPosition(slide.body.world, 'pelvis').y); // by the hip, low
    expect(tipPosition(slide.body.skeleton, slide.body.world, 'handL').y).toBeGreaterThan(0); // its fingertips over the floor
    const ctx = restContext(getBuild('build:adult'));
    const seat = pelvisTarget({ ...ctx, slide: 1, crouch: 1 }, new Vector3()).y;
    expect(pelvisTarget(ctx, new Vector3()).y - seat).toBeGreaterThan(0.25);
    expect(spineDirection({ ...ctx, slide: 1, crouch: 1 }, new Vector3()).z).toBeLessThan(0); // leaned back
  });

  it('fall: the legs reach down from the tuck and the arms rise out', () => {
    const [rising, falling] = [posed({ fall: -1 }, true), posed({ fall: 1 }, true)];
    expect(rising.socket('contactR').y - falling.socket('contactR').y).toBeGreaterThan(0.2);
    expect(falling.socket('weaponR').y).toBeGreaterThan(rising.socket('weaponR').y);
  });

  it('hard landing: the pelvis deep, the spine forward, the right hand on the floor ahead', () => {
    const ctx = restContext(getBuild('build:adult'));
    const [stand, soft, hard] = [0, 0, 1].map((h, i) => pelvisTarget({ ...ctx, shown: { ...createShown(), land: i ? 1 : 0, hard: h } }, new Vector3()).y); // prettier-ignore
    expect(stand - soft).toBeCloseTo(SHOWN.softDrop * ctx.build.hipHeight, 9);
    expect(stand - hard).toBeCloseTo(SHOWN.hardDrop * ctx.build.hipHeight, 9);
    const landed = posed({ land: 1, hard: 1 });
    expect(landed.socket('weaponR').y).toBeLessThan(0.3); // reaching for the floor ahead
    expect(landed.socket('weaponR').z).toBeGreaterThan(0.2);
  });

  it('lean and bank: the spine tips into an acceleration and a turn', () => {
    const ctx = restContext(getBuild('build:adult'));
    const up = spineDirection(ctx, new Vector3());
    const ahead = spineDirection({ ...ctx, shown: { ...createShown(), lean: 0.2 } }, new Vector3());
    const banked = spineDirection({ ...ctx, shown: { ...createShown(), bank: 0.2 } }, new Vector3());
    expect(ahead.z - up.z).toBeGreaterThan(0.15);
    expect(up.x - banked.x).toBeGreaterThan(0.15); // right is −X
  });
});
