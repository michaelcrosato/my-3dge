/**
 * @file Unit tests for props on the stage (engine/gfx/stageProps.ts, PLAN.md WP 4.6 core proposal), in Node: a
 * stage with no prop makes no prop meshes and keeps its scene graph; the first prop makes them, a batch for every
 * prop, under the stage's scene; each prop is drawn where its pose puts it, `alpha` of the way from its pose a step
 * before (the centre along the line, the turn slerped), and a prop that leaves is no longer drawn; the warm-up sees
 * the batches made after it was registered, and the shader key says when props arrive; the stage draws a `sceneProp`
 * entity as its prop, never as a stand-in.
 * @see engine/gfx/stageProps.ts
 */
import { Matrix4, Quaternion, Scene, Vector3, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../core/registry';
import { SCENE_PROP_FIELDS } from '../sim/props';
import type { EntityData } from '../sim/state';
import { compileLevel } from '../world/level/compile';
import { createMaterialLibrary } from './materials/library';
import { createStage } from './stage';
import { createStageProps } from './stageProps';

/** A `sceneProp` entity: prop `prop` with its centre at `p`, turned `q`. */
const entity = (id: number, prop: string, p: number[], q = [0, 0, 0, 1]): EntityData =>
  ({ id, sceneProp: { prop, body: id, x: p[0], y: p[1], z: p[2], q } }) as EntityData;

/** The matrix in slot `slot` of the batch named `name`. */
function slotOf(props: ReturnType<typeof createStageProps>, name: string, slot = 0): Matrix4 {
  return props
    .meshes!.batches()
    .find((batch) => batch.name === name)!
    .getMatrixAt(slot, new Matrix4());
}

/** Whether `a` and `b` agree to float32 precision. */
const near = (a: Matrix4, b: Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5);

/** A warm-up stand-in that records what is registered and the shader key's parts. */
function fakeWarmup() {
  const entries = new Map<string, { objects(): readonly Object3D[] }>();
  const parts = new Map<string, () => string>();
  return {
    entries,
    parts,
    register(id: string, entry: { objects(): readonly Object3D[] }) {
      entries.set(id, entry);
      return { dispose: () => entries.delete(id) };
    },
    keyPart(name: string, part: () => string) {
      parts.set(name, part);
      return { dispose: () => parts.delete(name) };
    },
  };
}

describe('props on the stage', () => {
  it('makes no prop meshes until the first prop, then a batch for every prop under the scene', () => {
    const scene = new Scene();
    const props = createStageProps({ scene, materials: createMaterialLibrary() });
    expect(props.capture([{ id: 1, actor: { x: 0, z: 0 } } as EntityData], 1 / 60)).toEqual(new Set());
    props.draw(1);
    expect([props.meshes, scene.children.length]).toEqual([null, 0]);
    const drawn = props.capture([entity(4, 'prop:crate', [2, 0.375, 3]), entity(5, 'prop:brazier', [0, 1.1, 0])]);
    expect(drawn).toEqual(new Set([4, 5]));
    expect([...props.props]).toEqual([
      [4, 'prop:crate'],
      [5, 'prop:brazier'],
    ]);
    expect(scene.children).toEqual([props.meshes!.root]);
    expect(props.meshes!.batches().map((batch) => batch.name)).toEqual(
      registry
        .list('prop')
        .flatMap((prop) => (prop.parts as { name: string }[]).map((part) => `${prop.id}/${part.name}`)),
    );
    props.draw(1);
    expect(near(slotOf(props, 'prop:crate/mesh'), new Matrix4().makeTranslation(2, 0, 3))).toBe(true);
    const flames = props.meshes!.batches().find((batch) => batch.name === 'prop:brazier/flames')!;
    expect(flames.count).toBe(6); // three tongues, each a flame round a core
    expect(props.lights().map((light) => light.tag)).toEqual(['torch']);
    props.dispose();
    expect(scene.children).toEqual([]);
  });

  it('draws each prop alpha of the way from its pose a step before, and stops drawing one that leaves', () => {
    const props = createStageProps({ scene: new Scene(), materials: createMaterialLibrary() });
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.2);
    props.capture([entity(1, 'prop:crate', [0, 0.375, 0])], 1 / 60);
    props.capture([entity(1, 'prop:crate', [1, 1.375, -2], turned.toArray())], 1 / 60);
    props.draw(0.25);
    const centre = new Vector3(0.25, 0.625, -0.5);
    const turn = new Quaternion().slerp(turned, 0.25);
    const expected = new Matrix4()
      .compose(centre, turn, new Vector3(1, 1, 1))
      .multiply(new Matrix4().makeTranslation(0, -0.375, 0));
    expect(near(slotOf(props, 'prop:crate/mesh'), expected)).toBe(true);
    props.capture([], 1 / 60);
    props.draw(1);
    expect(props.meshes!.batches().find((batch) => batch.name === 'prop:crate/mesh')!.count).toBe(0);
    expect(props.props.size).toBe(0);
  });

  it('registers batches made after the warm-up, and puts their arrival in the shader key', () => {
    const props = createStageProps({ scene: new Scene(), materials: createMaterialLibrary() });
    const warmup = fakeWarmup();
    const registration = props.register(warmup);
    expect(warmup.parts.get('stage:props')!()).toBe('');
    expect([...warmup.entries.keys()]).toEqual([]);
    props.capture([entity(1, 'prop:barrel', [0, 0.4375, 0])]);
    expect(warmup.parts.get('stage:props')!()).toBe('props');
    expect([...warmup.entries.keys()]).toEqual(props.meshes!.batches().map((batch) => `batch:${batch.name}`));
    registration.dispose();
    expect([warmup.entries.size, warmup.parts.size]).toEqual([0, 0]);
  });

  it('the stage draws a sceneProp entity as its prop, never as a stand-in', () => {
    expect(SCENE_PROP_FIELDS.x.unit).toBe('m'); // so the view hands props to the stage
    const level = compileLevel('#####\n#...#\n#####\n', { file: 'nook.txt' });
    const stage = createStage({ level, materials: createMaterialLibrary(), registry });
    expect(stage.kinds).toContain('sceneProp');
    stage.capture([entity(1, 'prop:crate', [2.5, 0.375, 1.5])], 1 / 60);
    stage.draw(1);
    expect([stage.standIns.size, stage.props.props.get(1)]).toEqual([0, 'prop:crate']);
    expect(stage.scene.children).toContain(stage.props.meshes!.root);
    stage.dispose();
  });
});
