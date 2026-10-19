/**
 * @file Unit tests for first person's player (engine/gfx/viewmodel/body.ts, PLAN.md WP 13.12): the arms are a mesh
 * of the body's arm and kicking-leg pieces, riding the body's mesh, casting no shadow and hidden until first person;
 * the body carries the `viewmodel` attribute, and each wears its kind of the look's copies; a first-person frame folds
 * the whole body (or, with the full body on, its head and arms and what is near the eye) and poses the arms' vertices
 * where the rig puts their bones; a
 * frame that is not first person shows the body whole and hides the arms; the arms follow the body's name and tags.
 */
import { MeshLambertMaterial, type BufferAttribute, type Material } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Animator } from '../../anim/character';
import { socketPosition } from '../../anim/fk';
import { JOINTS } from '../../anim/skeleton';
import { Vector3 } from '../../core/math';
import { eyePoint, FIRST_ARMS, FIRST_KICK } from '../cameras/first';
import { makePose } from '../cameras/pose';
import '../puppets/bodies/humanoid';
import { compileBody } from '../puppets/compile';
import { createPuppet, type PieceRange } from '../puppets/draw';
import { armsBody, createViewmodel } from './body';
import { createViewmodelLook } from './material';

const materials = { get: () => new MeshLambertMaterial({ vertexColors: true }) };

/** The player's puppet with its viewmodel, and an animator posed standing at the origin. */
function player() {
  const puppet = createPuppet(compileBody('body:humanoid', 'build:adult'), { materials, name: 'actor#1' });
  Object.assign(puppet.mesh.userData, { entity: 1, component: 'actor', protagonist: true });
  const look = createViewmodelLook();
  const viewmodel = createViewmodel(puppet, { materials, look });
  const animator = new Animator({ build: 'build:adult', clock: 1 }).update({ position: new Vector3() });
  const eye = eyePoint(animator.body.skeleton, animator.body.world);
  const frame = { pose: makePose({ position: eye, fov: 74, near: 0.05 }), dt: 1 / 60, aspect: 16 / 9, player: null, effects: null }; // prettier-ignore
  return { puppet, look, viewmodel, animator, frame };
}

/** The `viewmodel` attribute of `mesh`'s geometry, as values by joint (the bone each vertex rides). */
function marks(mesh: { geometry: { getAttribute(name: string): unknown } }): Map<string, Set<number>> {
  const [mark, bone] = ['viewmodel', 'skinIndex'].map((name) => mesh.geometry.getAttribute(name) as BufferAttribute);
  const out = new Map<string, Set<number>>();
  for (let i = 0; i < mark.count; i++) {
    const joint = JOINTS[bone.getX(i) - 1] ?? 'root';
    out.set(joint, (out.get(joint) ?? new Set()).add(mark.getX(i)));
  }
  return out;
}

describe('first person’s player', () => {
  it('gives the body its arms: the arm and kicking-leg pieces, riding the body, casting no shadow, hidden', () => {
    const { puppet, look, viewmodel } = player();
    const arms = viewmodel.arms;
    expect(arms.parent).toBe(puppet.mesh);
    expect([arms.name, arms.castShadow, arms.visible, puppet.mesh.castShadow]).toEqual(['actor#1/arms', false, false, true]); // prettier-ignore
    const bones = new Set(armsBody(puppet.compiled).pieces.map((piece) => JOINTS[piece.bone]));
    for (const bone of bones) expect([...FIRST_ARMS, ...FIRST_KICK]).toContain(bone); // the humanoid's toe rides its foot
    expect([...bones]).toEqual(expect.arrayContaining([...FIRST_ARMS, 'thighR', 'shinR', 'footR']));
    expect([...new Set([...marks(puppet.mesh).values()].flatMap((set) => [...set]))]).toEqual([0]); // as they are
    for (const mesh of [puppet.mesh, arms]) {
      for (const material of mesh.material as Material[]) expect(look.owns(material)).toBe(true);
      expect(typeof mesh.userData.restyle).toBe('function');
    }
    expect((puppet.mesh.material as Material[])[0]).not.toBe((arms.material as Material[])[0]); // the body's copy, the arms'
    expect([arms.userData.entity, arms.userData.protagonist, arms.userData.viewmodel]).toEqual([1, true, 'arms']);
  });

  it('folds the whole body for a first-person frame and draws the arms where the rig poses them', () => {
    const { puppet, viewmodel, animator, frame } = player();
    const parts = viewmodel.update(frame, { animator, contacts: null });
    expect(parts.hidden).toEqual([...JOINTS]);
    expect(parts.arms).toEqual(viewmodel.rig.shown);
    expect([...new Set([...marks(puppet.mesh).values()].flatMap((set) => [...set]))]).toEqual([1]);
    expect(viewmodel.arms.visible).toBe(true);
    // the arms' vertices posed from the rig: the right fist's ball centred on the grip it reaches for
    const { rig } = viewmodel;
    const geometry = viewmodel.arms.geometry;
    const ranges = geometry.userData.pieces as PieceRange[];
    const [position, bones] = [geometry.getAttribute('position'), geometry.getAttribute('skinIndex')];
    const fist = ranges.find((range) => range.shape === 'ball' && JOINTS[bones.getX(range.start) - 1] === 'handR')!;
    const [min, max, v] = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity), new Vector3()]; // prettier-ignore
    for (let i = fist.start; i < fist.start + fist.count; i++) [min, max].forEach((b, k) => (k ? b.max(v.fromBufferAttribute(position, i)) : b.min(v.fromBufferAttribute(position, i)))); // prettier-ignore
    const centre = min.add(max).multiplyScalar(0.5); // the middle of the ball's bounds: its centre
    expect(centre.distanceTo(socketPosition(rig.skeleton, rig.world, 'weaponR'))).toBeLessThan(1e-5);
    expect(centre.distanceTo(rig.hands[1])).toBeLessThan(1e-5);
  });

  it('shows the body under the camera beside the arms with the full body on, and all of it out of first person', () => {
    const { puppet, viewmodel, animator, frame } = player();
    const parts = viewmodel.update({ ...frame, fullBody: true }, { animator, contacts: null });
    expect(parts.hidden).toEqual(expect.arrayContaining(['head', 'upperArmL', 'forearmR', 'handR']));
    expect(parts.hidden).not.toContain('thighL');
    const shown = marks(puppet.mesh);
    expect([...shown.get('thighL')!]).toEqual([0]);
    expect([...shown.get('handR')!]).toEqual([1]);
    expect(viewmodel.update(null, null)).toEqual({ hidden: [], arms: [] });
    expect([...new Set([...marks(puppet.mesh).values()].flatMap((set) => [...set]))]).toEqual([0]);
    expect(viewmodel.arms.visible).toBe(false);
  });

  it('names and tags the arms as the actor now wearing the body', () => {
    const { puppet, viewmodel, animator, frame } = player();
    puppet.mesh.name = 'actor#7';
    Object.assign(puppet.mesh.userData, { entity: 7, protagonist: false });
    viewmodel.update(frame, { animator, contacts: null });
    const arms = viewmodel.arms;
    expect([arms.name, arms.userData.entity, arms.userData.protagonist]).toEqual(['actor#7/arms', 7, false]);
  });
});
