/**
 * @file Unit tests for crowd drawing (engine/gfx/puppets/crowd.ts) and the blob and floater bodies
 * (bodies/blob.ts, bodies/floater.ts), in Node: a humanoid drawn as createPuppetBatches draws it, without its capes in
 * a band without capes, with a blob shadow sized by its build; the slime's body through the rig's body matrix, its
 * eyes on the eye joints with pupils in front along the look, slits while squinting, horns and ears following the
 * squash, wings spanning their joints, every part but the body scaled with the rig's radius; the wisp's core and halo
 * through the core's matrix and a mote on each mote; the materials (unlit eyes, the see-through halo casting no
 * shadow); rig bodies on any joints, and their problems named; the draw calls (a call per shown page, lit pages again
 * per shadow map), a crowd growing by pages only, the warm-up registration and the stats. The GPU half (5,000 drawn,
 * no pipeline built, the budget, the hash with LOD on and off) is tests/e2e/crowd-render.spec.ts.
 * @see engine/gfx/puppets/crowd.ts
 */
import { Matrix4, PerspectiveCamera, Quaternion, Vector3, type InstancedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Blob, BLOB } from '../../anim/blob';
import { Floater } from '../../anim/floater';
import { Quadruped } from '../../anim/quadruped';
import { Pose } from '../../anim/pose';
import { toLinear } from '../../core/color';
import { createRegistry } from '../../core/registry';
import { createMaterialLibrary } from '../materials/library';
import { BLOB_BODY, BLOB_BODY_RADIUS, blobBody } from './bodies/blob';
import { FLOATER_BODY } from './bodies/floater';
import { QUADRUPED_BODY } from './bodies/quadruped';
import { HUMANOID_BODY } from './bodies/humanoid';
import { BLOB_SHADOW, blobScale } from './blobShadow';
import { compileBody } from './compile';
import { createCrowd, HUMANOID_SHADOW, type Crowd, type RigBody, type RigJoints } from './crowd';
import { createPuppetBatches } from './draw';
import { defineBody } from './grammar';

const library = createMaterialLibrary();
const humanoid = compileBody('body:humanoid', 'build:heroic');
const cape = ['cape', 'back', ['off', 'back', -0.06, 0, -0.55], 0.34, 'cloth'] as const;
const caped = compileBody(
  defineBody('body:caped', { ...HUMANOID_BODY, parts: [...HUMANOID_BODY.parts!, cape] }, createRegistry()),
  'build:chibi',
);
const near = { index: 0, upTo: 15, pose: 0, capes: true };
const far = { index: 3, upTo: 200, pose: 3, capes: false };

/** A crowd, drawn by `fn` between begin and end. */
function drawn(fn: (crowd: Crowd) => void, crowd = createCrowd({ materials: library })): Crowd {
  crowd.begin(new PerspectiveCamera());
  fn(crowd);
  crowd.end();
  return crowd;
}

/** Instance `slot` of `crowd`'s batch `key`: its matrix, and its position and column lengths. */
function instance(crowd: Crowd, key: string, slot: number) {
  const batch = crowd.rigs.get(key) ?? crowd.puppets.batches.get(key) ?? crowd.shadows!.batch;
  const matrix = batch.getMatrixAt(slot, new Matrix4());
  const [x, y, z] = [0, 4, 8].map((c) => new Vector3().fromArray(matrix.elements, c));
  return { matrix, at: new Vector3().setFromMatrixPosition(matrix), x, y, z, sizes: [x, y, z].map((v) => v.length()) };
}

/** Expects `a` and `b` (matrices or vectors) to agree within float32 rounding. */
const near32 = (a: { toArray(): number[] }, b: { toArray(): number[] }, what = '') =>
  a.toArray().forEach((v, i) => expect(v, `${what}[${i}]`).toBeCloseTo(b.toArray()[i], 5));

describe('humanoids', () => {
  it('draws a compiled body exactly as createPuppetBatches does', () => {
    const pose = new Pose();
    pose.rootPos.set(2, 0, -3);
    pose.rootRot.setFromAxisAngle(new Vector3(0, 1, 0), 0.8);
    const reference = createPuppetBatches({ materials: library, pageSlots: 8192 });
    reference.begin();
    reference.draw(humanoid, pose);
    reference.end();
    let written = 0;
    const crowd = drawn((c) => (written = c.humanoid(humanoid, pose, { band: near })));
    expect(written).toBe(62);
    expect([...crowd.puppets.batches.keys()]).toEqual([...reference.batches.keys()]);
    for (const [key, batch] of reference.batches) {
      const own = crowd.puppets.batches.get(key)!;
      expect(own.count, key).toBe(batch.count);
      for (let slot = 0; slot < batch.count; slot++)
        expect(own.getMatrixAt(slot, new Matrix4())).toEqual(batch.getMatrixAt(slot, new Matrix4()));
    }
  });

  it('leaves capes out in a band without capes, and nothing else', () => {
    const strips = caped.pieces.filter((piece) => piece.shape === 'strip').length;
    expect(strips).toBe(1);
    const counts = (band: typeof near) => {
      const crowd = drawn((c) => c.humanoid(caped, new Pose(), { band }));
      return Object.fromEntries([...crowd.puppets.batches].map(([key, batch]) => [key, batch.count]));
    };
    const [full, capeless] = [counts(near), counts(far)];
    expect(full.strip).toBe(1);
    expect({ ...capeless, strip: 1 }).toEqual(full);
  });

  it('lays a blob shadow under its root on the floor it is given, sized by its build and scale', () => {
    const pose = new Pose();
    pose.rootPos.set(1, 0.5, 2);
    pose.rootScale.setScalar(1.2);
    const crowd = drawn((c) => {
      c.humanoid(humanoid, pose, { floor: 0.25 });
      c.humanoid(humanoid, pose);
    });
    expect(crowd.shadows!.batch.count, 'only the one given a floor').toBe(1);
    const disc = instance(crowd, 'shadows', 0);
    near32(disc.at, new Vector3(1, 0.25 + BLOB_SHADOW.lift, 2));
    const radius = HUMANOID_SHADOW * humanoid.skeleton.build.size * 1.2 * blobScale(0.25);
    expect(disc.sizes[0]).toBeCloseTo(radius, 6);
  });
});

describe('blobs', () => {
  const R = BLOB.radius;
  /** A slime looking along `yaw`, stepped a few times toward a squash. */
  const slime = (options: { yaw?: number; radius?: number } = {}) => {
    const blob = new Blob(options);
    blob.position.set(3, 0.5, -2);
    for (let i = 0; i < 5; i++) blob.step({ squash: 0.3 });
    return blob;
  };

  it('draws the slime: its body through the rig’s body matrix, eyes on the eye joints, pupils in front', () => {
    const blob = slime({ yaw: 0.7 });
    const crowd = drawn((c) => expect(c.blob(blob)).toBe(5));
    const pose = blob.pose();
    expect(crowd.rigs.get('ball')!.count).toBe(5);
    near32(instance(crowd, 'ball', 0).matrix, pose.body, 'body');
    const look = new Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    for (const [slot, joint] of [
      [1, pose.eyeL],
      [3, pose.eyeR],
    ] as const) {
      const white = instance(crowd, 'ball', slot);
      near32(white.at, new Vector3().setFromMatrixPosition(joint), 'eye');
      white.sizes.forEach((size, i) => expect(size).toBeCloseTo([1.25, 1.6, 1.25][i] / 16, 6));
      const pupil = instance(crowd, 'ball', slot + 1);
      near32(pupil.at.clone().sub(white.at), look.clone().multiplyScalar(0.9 / 16), 'pupil ahead along the look');
    }
    expect(instance(crowd, 'ball', 0).matrix.determinant(), 'the volume kept').toBeCloseTo(R ** 3, 6);
    expect(crowd.rigs.get('ball')!.pages[0].instanceColor!.array.slice(0, 3)).toEqual(
      Float32Array.from(toLinear(BLOB_BODY.slots.base)),
    );
  });

  it('draws slits instead of eyes while squinting', () => {
    const blob = slime();
    blob.state.squint = true;
    const crowd = drawn((c) => expect(c.blob(blob)).toBe(3));
    instance(crowd, 'ball', 1).sizes.forEach((size, i) => expect(size).toBeCloseTo([1.1, 0.3, 1.1][i] / 16, 6));
  });

  it('puts horns on top, leaning out and following the squash; ears are shorter and dark', () => {
    const blob = slime({ yaw: -0.4 });
    const pose = blob.pose();
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.4);
    for (const [features, tall, slot] of [
      [{ horns: true }, 0.9, 'horn'],
      [{ ears: true }, 0.75, 'dark'],
    ] as const) {
      const body = blobBody(features);
      const crowd = drawn((c) => c.blob(blob, { body }));
      expect(crowd.rigs.get('cone')!.count).toBe(2);
      for (const [i, side] of [
        [0, 1],
        [1, -1],
      ] as const) {
        const horn = instance(crowd, 'cone', i);
        near32(horn.at, new Vector3(side * 0.45, 0.7, 0).applyMatrix4(pose.body), 'its base, through the squash');
        const lean = new Vector3(side * 0.35, 1, 0).normalize().applyQuaternion(turn);
        near32(horn.y.clone().normalize(), lean, 'leaning out');
        expect(horn.sizes[1]).toBeCloseTo(tall * R * Math.hypot(0.35, 1), 6);
        expect([horn.sizes[0], horn.sizes[2]].map((s) => +s.toFixed(6))).toEqual(
          [0.3 * R, 0.3 * R].map((s) => +s.toFixed(6)),
        );
      }
      const colors = crowd.rigs.get('cone')!.pages[0].instanceColor!.array.slice(0, 3);
      expect(colors).toEqual(Float32Array.from(toLinear(body.slots[slot])));
    }
  });

  it('spans each wing joint with a flat box, root to tip, 0.9 R wide along the look', () => {
    const blob = slime();
    for (let i = 0; i < 9; i++) blob.step({ flap: 1 });
    const pose = blob.pose();
    const crowd = drawn((c) => expect(c.blob(blob, { body: blobBody({ wings: true }) })).toBe(7));
    for (const [slot, joint] of [
      [0, pose.wingL],
      [1, pose.wingR],
    ] as const) {
      const wing = instance(crowd, 'box', slot);
      near32(wing.y, new Vector3().setFromMatrixColumn(joint, 1), 'root to tip');
      near32(wing.at, new Vector3(0, 0.5, 0).applyMatrix4(joint), 'centred between them');
      expect([wing.sizes[0], wing.sizes[2]].map((s) => +s.toFixed(6))).toEqual([+(0.9 * R).toFixed(6), 0.015625]);
    }
  });

  it('scales every part but the stretching ones with the rig’s radius, and lays its shadow', () => {
    const blob = slime({ radius: 2 * BLOB_BODY_RADIUS });
    const crowd = drawn((c) => c.blob(blob, { floor: 0.5 }));
    near32(instance(crowd, 'ball', 0).matrix, blob.pose().body, 'the body: the rig’s own matrix');
    expect(instance(crowd, 'ball', 1).sizes[1]).toBeCloseTo((2 * 1.6) / 16, 6);
    const disc = instance(crowd, 'shadows', 0);
    near32(disc.at, new Vector3(3, 0.5 + BLOB_SHADOW.lift, -2));
    expect(disc.sizes[0]).toBeCloseTo((2 * 6) / 16, 6);
  });
});

describe('floaters', () => {
  it('draws the core and its halo through the core’s matrix, and a mote on each mote, casting no shadow', () => {
    const wisp = new Floater({ clock: 1.3 });
    wisp.position.set(-1, 1.25, 4);
    for (let i = 0; i < 6; i++) wisp.step({ velocity: new Vector3(3, 0, i), swell: 0.5 });
    const crowd = drawn((c) => expect(c.floater(wisp, { floor: 0 })).toBe(5));
    const pose = wisp.pose();
    near32(instance(crowd, 'eye', 0).matrix, pose.core.clone().scale(new Vector3().setScalar(0.2)), 'core');
    near32(
      instance(crowd, 'ball~material:puppetHalo', 0).matrix,
      pose.core.clone().scale(new Vector3().setScalar(0.2875)),
    );
    pose.motes.forEach((mote, i) => {
      const drawn = instance(crowd, 'eye', i + 1);
      near32(drawn.at, mote, `mote ${i}`);
      expect(drawn.sizes[0]).toBeCloseTo(0.7 / 16, 6);
    });
    expect(crowd.shadows!.batch.count, 'a wisp casts no blob shadow').toBe(0);
    expect(FLOATER_BODY.shadow).toBeUndefined();
  });

  it('draws the dog on a quadruped’s joints, a paw on each foot of its gait, and its shadow under it', () => {
    const dog = new Quadruped();
    const v = new Vector3(0, 0, 1.5);
    for (let i = 0; i < 40; i++) dog.step({ position: dog.position.clone().addScaledVector(v, 1 / 60), velocity: v, wag: 1 }); // prettier-ignore
    const pose = dog.pose() as RigJoints & ReturnType<Quadruped['pose']>;
    const parts = QUADRUPED_BODY.parts.reduce((n, part) => n + (part.on === 'paws' ? 4 : 1), 0);
    const crowd = drawn((c) => expect(c.rig(QUADRUPED_BODY, pose, { floor: 0 })).toBe(parts));
    const paws = QUADRUPED_BODY.parts.findIndex((part) => part.on === 'paws');
    const before = QUADRUPED_BODY.parts.slice(0, paws).filter((part) => part.shape === 'ball').length;
    pose.paws.forEach((paw, i) => near32(instance(crowd, 'ball', before + i).at, paw.clone().add(new Vector3(0, 0.026, 0)), `paw ${i}`)); // prettier-ignore
    const neck = instance(
      crowd,
      'ball',
      QUADRUPED_BODY.parts.findIndex((part) => part.on === 'neck'),
    );
    expect(neck.sizes[1]).toBeCloseTo(0.55 * new Vector3().setFromMatrixColumn(pose.neck, 1).length(), 5); // along its bone
    expect(crowd.shadows!.batch.count).toBe(1);
  });

  it('draws the halo see-through, without depth or shadow; eyes unlit; lit parts casting shadows', () => {
    const crowd = drawn((c) => {
      c.floater(new Floater());
      c.blob(new Blob({ yaw: 1 }));
    });
    const page = (key: string): InstancedMesh => crowd.rigs.get(key)!.pages[0];
    const halo = page('ball~material:puppetHalo');
    expect(halo.material).toMatchObject({ transparent: true, depthWrite: false, opacity: 0.35 });
    expect([halo.castShadow, page('eye').castShadow, page('ball').castShadow]).toEqual([false, false, true]);
    expect(page('eye').material).toBe(library.get('material:puppetGlow'));
    expect(page('ball').material).toBe(library.get('material:puppet'));
  });
});

describe('rig bodies', () => {
  const body = (parts: RigBody['parts']): RigBody => ({
    name: 'test',
    description: '',
    slots: { a: '#ffffff' },
    parts,
  });

  it('rides any joints: a matrix, a point, or a list of points (a part on each)', () => {
    const joints = {
      m: new Matrix4().makeTranslation(1, 2, 3),
      p: new Vector3(4, 5, 6),
      list: [new Vector3(), new Vector3(0, 1, 0)],
    };
    const parts = (['m', 'p', 'list'] as const).map((on) => ({ shape: 'box' as const, on, size: 0.5, slot: 'a' }));
    const crowd = drawn((c) => expect(c.rig(body(parts), joints)).toBe(4));
    expect([0, 1, 2, 3].map((slot) => instance(crowd, 'box', slot).at.toArray())).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [0, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('refuses a part with an unknown shape, a slot the body lacks, a size not above 0, or a joint the pose lacks', () => {
    const fails =
      (part: object, joints = { j: new Matrix4() }) =>
      () =>
        drawn((c) =>
          c.rig(body([{ shape: 'ball', on: 'j', size: 1, slot: 'a', ...part } as RigBody['parts'][0]]), joints),
        );
    expect(fails({ shape: 'limb' })).toThrow(/GFX_RIG_BODY.*rig body test, part 0: limb is no shape/);
    expect(fails({ slot: 'b' })).toThrow(/GFX_RIG_BODY.*slot b is not in slots/);
    expect(fails({ size: [1, 0, 1] })).toThrow(/GFX_RIG_BODY.*size \[1,0,1\]/);
    expect(fails({ on: 'k' })).toThrow(/GFX_RIG_BODY.*the pose has no joint k.*ride one of its joints: j/);
  });
});

describe('the crowd', () => {
  it('costs a draw call per shown page, lit pages again per shadow map', () => {
    const crowd = drawn((c) => {
      c.humanoid(humanoid, new Pose(), { floor: 0 });
      c.blob(new Blob(), { floor: 0 });
      c.floater(new Floater());
    });
    const shown = [...crowd.puppets.batches.values(), ...crowd.rigs.values(), crowd.shadows!.batch].filter(
      (b) => b.count,
    );
    const lit = shown.filter((batch) => batch.pages[0].castShadow);
    expect(crowd.drawCalls()).toBe(shown.length);
    expect(crowd.drawCalls(1)).toBe(shown.length + lit.length);
    expect(lit.length, 'the puppets’ lit shapes and the rigs’ balls').toBe(4);
  });

  it('grows by pages only: once its bodies are prepared, no batch is made however large the crowd', () => {
    const crowd = createCrowd({ materials: library, pageSlots: 1024 });
    crowd.prepare(humanoid, caped, BLOB_BODY, blobBody({ horns: true, wings: true }), FLOATER_BODY);
    const keys = () => [...crowd.puppets.batches.keys(), ...crowd.rigs.keys()];
    const before = keys();
    let objects: () => readonly unknown[] = () => [];
    crowd.register({ register: (_id, entry) => ((objects = entry.objects), { dispose() {} }) });
    drawn((c) => {
      for (let i = 0; i < 400; i++) {
        c.humanoid(i % 2 ? humanoid : caped, new Pose(), { band: near, floor: 0 });
        c.blob(new Blob(), { floor: 0, body: blobBody({ horns: true, wings: true }) });
        c.floater(new Floater());
      }
    }, crowd);
    expect(keys()).toEqual(before);
    expect(crowd.puppets.batches.get('ball')!.pages.length, '16,800 balls').toBe(17);
    const pages = [...crowd.puppets.batches.values(), ...crowd.rigs.values(), crowd.shadows!.batch].flatMap(
      (b) => b.pages,
    );
    expect(objects(), 'the warm-up sees every page, those added since too').toEqual(pages);
    const stats = crowd.stats();
    expect(stats.bodies).toBe(1200);
    expect([stats.instances['crowd/rigs/eye'], stats.pages['crowd/puppets/ball']]).toEqual([1600, 17]);
  });

  it('sees through its level of detail, and counts what it saw', () => {
    const crowd = createCrowd({ materials: library, lod: { near: 0.5 } });
    const camera = new PerspectiveCamera(50, 1, 0.1, 500);
    crowd.begin(camera);
    expect([crowd.see(0, 0, -20, 1)?.index, crowd.see(0, 0, 20, 1), crowd.see(0, 0, -0.2, 1)]).toEqual([1, null, null]);
    expect(crowd.stats().lod).toEqual({ bands: [0, 1, 0, 0], outside: 1, far: 0, near: 1 });
    crowd.end();
    const parent = createCrowd({ materials: library, shadows: false });
    expect(parent.shadows).toBeNull();
    parent.root.parent?.remove(parent.root);
    parent.dispose();
    expect(parent.root.parent).toBeNull();
  });
});
