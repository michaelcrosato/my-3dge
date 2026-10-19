/**
 * @file The viewmodel's materials (PLAN.md WP 13.12): first person's player is drawn by two meshes in the materials
 * the stage gives them (engine/gfx/viewmodel/body.ts: the body and the arms), each in a node material copy of its own:
 * - the body's (`body(material)`), on its skinned mesh, folds to a point every vertex whose `viewmodel` attribute is 1,
 *   so the camera sees none of the body, and draws its shadow from every vertex where skinning puts it
 *   (`castShadowPositionNode`), so the shadow stays whole;
 * - the arms' (`arms(material)`), on a mesh the CPU poses, draws each vertex by the arms' lens (engine/gfx/viewmodel/
 *   lens.ts: on its ray from the eye, at their own depth, spread by their own field of view) and takes the shadows
 *   falling where it really is (`receivedShadowPositionNode`), not where it is drawn, inside the body's own head.
 * Measured on r182 (WP 13.12): a skinned mesh's `positionNode` is handed the vertex before skinning, and what it
 * returns is skinned, so a lens there would act on the bind pose; the arms are therefore posed on the CPU. The ID pass
 * and the post chain's scene pass take a copy's position, so they see what the frame draws. A copy is made once per
 * source, carrying every property (`nodeCopy`) and its source's `userData` (the style set re-points it by its entry,
 * engine/gfx/materials/styles.ts, and the meshes wrap what it gives them through this look).
 *
 * The lens's uniforms (`frame(pose, fov)`: the spread, the near plane and the camera's view, all from the frame's pose,
 * as the CPU's own checks take them, lens.ts) are the render group's: one picture, one first-person camera. A material
 * three.js cannot copy into a node material is left as it is, with
 * advice `GFX_VIEWMODEL_MATERIAL` once: then the body shows, or the arms are no longer drawn at their own depth.
 *
 * Invariants: presentation only; a body copy draws a vertex whose attribute is 0 exactly as its source does; changing
 * the uniforms builds nothing; `dispose` frees the copies (the sources stay their owners').
 *
 * @example
 * import { MeshLambertMaterial } from 'three/webgpu';
 * const look = createViewmodelLook();
 * const lit = new MeshLambertMaterial({ vertexColors: true });
 * const arms = look.arms(lit);
 * [arms.type, look.arms(lit) === arms, look.arms(arms) === arms, look.body(lit) === arms]; // ['MeshLambertMaterial', true, true, false]
 * look.dispose();
 * @see engine/gfx/viewmodel/material.test.ts
 * @see tests/e2e/playground-cameras.spec.ts
 */
import {
  attribute,
  float,
  Fn,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionLocal,
  renderGroup,
  select,
  uniform,
  varyingProperty,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Matrix4,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  type Material,
  type Node,
  type NodeMaterial,
} from 'three/webgpu';
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import { poseForward, poseRight, poseUp, type CameraPose } from '../cameras/pose';
import { armsSpread, VIEWMODEL } from './lens';

/** The codes this module raises, with their fixes. */
export const VIEWMODEL_MATERIAL_CODES = defineCodes('gfx', {
  GFX_VIEWMODEL_MATERIAL: {
    template: 'first person cannot draw {material} for the viewmodel: three.js has no node material for a {type}',
    fix: "give the player's body a mesh material three.js turns into a node material (Lambert, Phong, standard, toon, basic, or a node material)", // prettier-ignore
    doc: 'Advice from the viewmodel (engine/gfx/viewmodel/material.ts), once per material: a material it cannot copy into a node material is drawn as it is, so first person shows the body, or the arms are no longer drawn at their own depth and a wall may cut them.', // prettier-ignore
  },
});

/** The node material three.js draws each classic material type as (its standard library's). */
const NODE_CLASSES: Readonly<Record<string, new () => NodeMaterial>> = {
  MeshLambertMaterial: MeshLambertNodeMaterial,
  MeshBasicMaterial: MeshBasicNodeMaterial,
  MeshStandardMaterial: MeshStandardNodeMaterial,
  MeshPhongMaterial: MeshPhongNodeMaterial,
  MeshToonMaterial: MeshToonNodeMaterial,
};

/** What a copy keeps of its own: its identity, its version and its `userData` (a deep copy of the source's). */
const OWN = new Set(['uuid', 'version', 'userData']);

/**
 * A node material drawn as `material` is, with an id of its own (null when three.js has none for it): every property
 * of the source, as three.js's `NodeLibrary.fromMaterial` turns a classic material into its node material (r182's
 * `NodeMaterial.copy`, and so `clone`, keeps the node properties alone: a cloned standard material lost its roughness).
 */
function nodeCopy(material: Material): NodeMaterial | null {
  const node = (material as NodeMaterial).isNodeMaterial === true;
  const Class = node ? null : NODE_CLASSES[material.type];
  if (!node && !Class) return null;
  const fresh = material.clone() as unknown as Record<string, unknown>; // an id, a uuid and userData of its own
  const copy = (Class ? new Class() : fresh) as unknown as Record<string, unknown>;
  const source = material as unknown as Record<string, unknown>;
  for (const key in source) if (!OWN.has(key) && !key.startsWith('_')) copy[key] = source[key];
  [copy.uuid, copy.userData] = [fresh.uuid, fresh.userData];
  return copy as unknown as NodeMaterial;
}

/** The viewmodel's materials (see the file comment). */
export interface ViewmodelLook {
  /** `material`'s copy for the body: it folds the vertices marked 1 and casts the whole body's shadow. */
  body(material: Material): Material;
  /** `material`'s copy for the arms: each vertex drawn by the arms' lens, its shadows taken where it really is. */
  arms(material: Material): Material;
  /** Whether `material` is one of this look's copies. */
  owns(material: Material): boolean;
  /** Sets the lens for a frame drawn through `pose`, the arms' lens `fov` (vertical degrees). */
  frame(pose: CameraPose, fov?: number): void;
  /** The lens's numbers now: the spread, the drawn near plane (m) and the camera's view matrix. */
  readonly lens: { readonly spread: number; readonly base: number; readonly view: Matrix4 };
  dispose(): void;
}

/** Makes the viewmodel's materials (see the file comment); `log` takes the advice. */
export function createViewmodelLook(options: { log?: Log } = {}): ViewmodelLook {
  const log = options.log ?? sharedLog;
  const spread = uniform(1).setGroup(renderGroup);
  const base = uniform(0.05 * VIEWMODEL.lift).setGroup(renderGroup);
  /** The camera's view matrix and its world matrix, from the frame's pose (see `frame`). */
  const toView = uniform(new Matrix4()).setGroup(renderGroup);
  const fromView = uniform(new Matrix4()).setGroup(renderGroup);
  const [near, squeeze] = [float(VIEWMODEL.near), float(VIEWMODEL.squeeze)];
  const folded = select(attribute('viewmodel', 'float').greaterThan(0.5), vec3(0, 0, 0), positionLocal) as unknown as Node; // prettier-ignore
  /** Where the vertex really is, world: the shadows it takes fall there. */
  const placed = varyingProperty('vec3', 'vViewmodelPlaced');
  const lensed = Fn(() => {
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.toVar();
    placed.assign(world);
    const view = toView.mul(vec4(world, 1)).xyz.toVar();
    const z = view.z.negate();
    const f = select(z.greaterThanEqual(near), base.add(z.sub(near).mul(squeeze)).div(z), base.div(near));
    const drawn = vec3(view.x.mul(spread), view.y.mul(spread), view.z).mul(f);
    return modelWorldMatrixInverse.mul(fromView.mul(vec4(drawn, 1))).xyz;
  })() as unknown as Node;
  const caches = { body: new Map<Material, Material>(), arms: new Map<Material, Material>() };
  const own = new Set<Material>();
  /** `material`'s copy of kind `kind`, made once (see the file comment). */
  const wrap = (kind: 'body' | 'arms', material: Material): Material => {
    if (own.has(material)) return material;
    const made = caches[kind].get(material);
    if (made) return made;
    const copy = nodeCopy(material);
    if (!copy) {
      log.warnOnce('GFX_VIEWMODEL_MATERIAL', { material: material.name || material.type, type: material.type }, material.uuid); // prettier-ignore
      return material;
    }
    copy.name = `${material.name || material.type}+${kind}`;
    if (kind === 'body') [copy.positionNode, copy.castShadowPositionNode] = [folded, positionLocal as unknown as Node];
    else [copy.positionNode, copy.receivedShadowPositionNode] = [lensed, placed as unknown as Node];
    caches[kind].set(material, copy);
    own.add(copy);
    return copy;
  };
  return {
    body: (material) => wrap('body', material),
    arms: (material) => wrap('arms', material),
    owns: (material) => own.has(material),
    frame(pose, fov = VIEWMODEL.fov) {
      spread.value = armsSpread(pose, fov);
      base.value = pose.near * VIEWMODEL.lift;
      const [r, u, f] = [poseRight(pose), poseUp(pose), poseForward(pose)];
      const [x, y, z] = pose.position;
      fromView.value.set(r[0], u[0], -f[0], x, r[1], u[1], -f[1], y, r[2], u[2], -f[2], z, 0, 0, 0, 1); // three's cameras look down −Z
      toView.value.copy(fromView.value).invert();
    },
    get lens() {
      return { spread: spread.value, base: base.value, view: toView.value.clone() };
    },
    dispose() {
      for (const copy of own) copy.dispose();
      for (const cache of Object.values(caches)) cache.clear();
      own.clear();
    },
  };
}
