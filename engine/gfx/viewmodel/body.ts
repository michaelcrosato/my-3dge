/**
 * @file First person's player (PLAN.md WP 13.12, docs/PLAYGROUND.md §4): the body and the arms a first-person camera
 * sees. `createViewmodel(puppet, { materials, look })` takes the player's puppet (engine/gfx/puppets/draw.ts) and adds
 * the arms: a mesh of the same compiled body's arm and right-leg pieces alone (`armsBody`), a child of the body's mesh,
 * casting no shadow, posed on the CPU each frame from the arms rig (engine/gfx/viewmodel/rig.ts), each vertex by the
 * one bone it rides as the puppet's rigid skinning would, since r182 skins a mesh after its position node and the
 * arms' lens must see them posed (engine/gfx/viewmodel/material.ts). The body's mesh carries the `viewmodel` attribute
 * and wears its materials' body copies, the arms their arms copies; each wraps what the style set gives it later
 * (`userData.restyle`, engine/gfx/materials/styles.ts). `update(frame, animated)` each drawn frame:
 * - first person (a `ViewmodelFrame`): the body's vertices fold (1), all of them or, with `fullBody`, those of the
 *   parts it hides (engine/gfx/cameras/first.ts `firstBodyCull`), so the camera sees none of it while its shadow stays
 *   whole; the rig poses the arms against the camera from the body's animator and its traversal plant (`armsInputOf`),
 *   the arms draw the parts it shows (the others folded to a point), and the look takes the frame's lens;
 * - otherwise (null): the body drawn as it is (0), the arms hidden.
 * It returns the joints the body hid and the ones the arms show.
 *
 * Invariants: presentation only; the body's attribute changes only when what it hides does (an upload, never a
 * pipeline); the arms exist from the start, so the warm-up builds their pipeline (the actors register them), and a
 * puppet keeps its viewmodel as a spare, the arms named and tagged as the body is; `dispose` frees the arms' geometry
 * (the body is its owner's).
 *
 * @example
 * import { MeshLambertMaterial } from 'three/webgpu';
 * import '../puppets/bodies/humanoid';
 * import { compileBody } from '../puppets/compile';
 * import { createPuppet } from '../puppets/draw';
 * import { createViewmodelLook } from './material';
 * const materials = { get: () => new MeshLambertMaterial({ vertexColors: true }) };
 * const puppet = createPuppet(compileBody('body:humanoid', 'build:adult'), { materials });
 * const viewmodel = createViewmodel(puppet, { materials, look: createViewmodelLook() });
 * viewmodel.arms.parent === puppet.mesh; // true: the arms ride the body's mesh, hidden until first person
 * viewmodel.update(null, null).hidden; // []: not first person, the body whole
 * @see engine/gfx/viewmodel/body.test.ts
 */
import { BufferAttribute, Mesh, type Material } from 'three/webgpu';
import type { Animator } from '../../anim/character';
import { JOINTS, type JointName } from '../../anim/skeleton';
import type { TraversalPlant } from '../../anim/traversal/plant';
import type { CameraPlayer, EffectsFrame } from '../cameras/effects';
import { FIRST_ARMS, FIRST_KICK, firstBodyCull } from '../cameras/first';
import type { CameraPose } from '../cameras/pose';
import type { CompiledBody } from '../puppets/compile';
import { puppetGeometry, type Puppet, type PuppetMaterials } from '../puppets/draw';
import type { ViewmodelLook } from './material';
import { armsInputOf, ArmsRig } from './rig';

/** A frame drawn by a first-person camera: its pose, the frame's real seconds and aspect, the player and the effects. */
export interface ViewmodelFrame {
  readonly pose: CameraPose;
  readonly dt: number;
  readonly aspect: number;
  readonly player: CameraPlayer | null;
  readonly effects: EffectsFrame | null;
  /** The arms' lens, vertical degrees (`VIEWMODEL.fov`; the setting `cam.armsFov`). */
  readonly fov?: number;
  /** Show the body under the camera beside the arms (the setting `cam.fullBody`). */
  readonly fullBody?: boolean;
}

/** What a frame hid of the body and showed of the arms. */
export interface FirstPersonParts {
  readonly hidden: readonly JointName[];
  readonly arms: readonly JointName[];
}

/** What the arms are posed from: the body's animator, posed this frame, and its traversal plant. */
export interface Animated {
  readonly animator: Animator;
  readonly contacts: TraversalPlant | null;
}

/** The pieces' bones the arms draw. */
const ARMS_BONES = new Set([...FIRST_ARMS, ...FIRST_KICK].map((joint) => JOINTS.indexOf(joint)));

/** `compiled` with its arm and kicking-leg pieces alone (no glow): what the arms draw. */
export function armsBody(compiled: CompiledBody): CompiledBody {
  return { ...compiled, pieces: compiled.pieces.filter((piece) => !piece.glow && ARMS_BONES.has(piece.bone)) };
}

/** First person's player on a puppet (see the file comment). */
export interface Viewmodel {
  /** The arms' mesh. */
  readonly arms: Mesh;
  /** The arms' rig: their pose and shown parts after the last first-person frame. */
  readonly rig: ArmsRig;
  /** Draws the body and the arms for `frame` (null: not first person), posed from the body's `animated` (see the file comment). */ // prettier-ignore
  update(frame: ViewmodelFrame | null, animated: Animated | null): FirstPersonParts;
  dispose(): void;
}

/** Gives `puppet` (the player's) its first-person arms and look (see the file comment). */
export function createViewmodel(
  puppet: Puppet,
  options: { materials: PuppetMaterials; look: ViewmodelLook },
): Viewmodel {
  const { look } = options;
  const body = puppet.mesh;
  const compiled = armsBody(puppet.compiled);
  const geometry = puppetGeometry(compiled);
  const materials = [compiled.body.material, compiled.body.glowMaterial].map((id) => look.arms(options.materials.get(id))); // prettier-ignore
  const arms = new Mesh(geometry, materials);
  const rig = new ArmsRig(puppet.compiled.skeleton.build);
  const count = body.geometry.getAttribute('position').count;
  body.geometry.setAttribute('viewmodel', new BufferAttribute(new Float32Array(count), 1));
  body.material = (Array.isArray(body.material) ? body.material : [body.material]).map((m) => look.body(m));
  body.userData.restyle = (material: Material) => look.body(material);
  Object.assign(arms, { name: `${body.name}/arms`, castShadow: false, receiveShadow: true, frustumCulled: false, visible: false }); // prettier-ignore
  arms.userData = { ...body.userData, viewmodel: 'arms', restyle: (material: Material) => look.arms(material) };
  body.add(arms);
  const marks = body.geometry.getAttribute('viewmodel') as BufferAttribute;
  const bodyBones = body.geometry.getAttribute('skinIndex');
  let folded = '';
  /** Folds the body's vertices on `hidden`'s parts and draws the rest as they are. */
  const fold = (hidden: readonly JointName[]) => {
    const key = hidden.join();
    if (key === folded) return;
    const set = new Set(hidden.map((joint) => JOINTS.indexOf(joint) + 1)); // the bones, as skinIndex holds them
    const all = hidden.length === JOINTS.length; // the root's pieces too
    for (let i = 0; i < marks.count; i++) marks.setX(i, all || set.has(bodyBones.getX(i)) ? 1 : 0);
    [folded, marks.needsUpdate] = [key, true];
  };
  const [position, normal] = [geometry.getAttribute('position'), geometry.getAttribute('normal')] as BufferAttribute[];
  const [rest, restNormal] = [Float32Array.from(position.array), Float32Array.from(normal.array)];
  const armBones = geometry.getAttribute('skinIndex');
  /** Poses the arms' vertices from the rig's world pose: each by its bone, the parts it does not show folded. */
  const pose = () => {
    const shown = new Set(rig.shown.map((joint) => JOINTS.indexOf(joint)));
    const { matrices } = rig.world;
    const [p, n] = [position.array as Float32Array, normal.array as Float32Array];
    for (let i = 0; i < position.count; i++) {
      const j = armBones.getX(i) - 1;
      if (!shown.has(j)) {
        p.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      const m = j * 16;
      const [x, y, z] = [rest[i * 3] - compiled.rest[j * 3], rest[i * 3 + 1] - compiled.rest[j * 3 + 1], rest[i * 3 + 2] - compiled.rest[j * 3 + 2]]; // prettier-ignore
      const [a, b, c] = [restNormal[i * 3], restNormal[i * 3 + 1], restNormal[i * 3 + 2]];
      for (let k = 0; k < 3; k++) {
        p[i * 3 + k] = matrices[m + k] * x + matrices[m + 4 + k] * y + matrices[m + 8 + k] * z + matrices[m + 12 + k];
        n[i * 3 + k] = matrices[m + k] * a + matrices[m + 4 + k] * b + matrices[m + 8 + k] * c;
      }
    }
    [position.needsUpdate, normal.needsUpdate] = [true, true];
  };
  return {
    arms,
    rig,
    update(frame, animated) {
      if (!frame || !animated) {
        fold([]);
        arms.visible = false;
        return { hidden: [], arms: [] };
      }
      const { player, effects, aspect, fov } = frame;
      look.frame(frame.pose, fov);
      rig.update(frame.pose, armsInputOf(animated.animator, animated.contacts, { player, effects, aspect, fov }), frame.dt); // prettier-ignore
      pose();
      const { entity, component, protagonist } = body.userData; // as the actor wearing the body now
      Object.assign(arms, { name: `${body.name}/arms`, visible: true });
      Object.assign(arms.userData, { entity, component, protagonist });
      const { skeleton, world } = animated.animator.body;
      const hidden = firstBodyCull(skeleton, world, frame.pose.position, frame.fullBody === true);
      fold(hidden);
      return { hidden, arms: [...rig.shown] };
    },
    dispose() {
      geometry.dispose();
      arms.removeFromParent();
      fold([]);
    },
  };
}
