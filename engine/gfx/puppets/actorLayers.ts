/**
 * @file What the actor puppets keep of each actor, and the view's own layers on its puppet animator (PLAN.md WP 3.10,
 * split from engine/gfx/puppets/actors.ts at WP 13.12): `Held`, an actor's last two places and the components its
 * pose loads; `Layers`, what the view lays on the animator (its reactions, its actions, its secondary motion and their
 * chain meshes, the foot plant, the traversal plant and the hold, the last three ending the `post` slot), made again
 * by `layersFor` when what they are made for changes (`layersKey`: reactions, actions, the secondary look, or the clip
 * layer actions ride; or the animator, made again when the weapon changes, the new hold following the old's draw),
 * and taken off with their meshes freed by `dropLayers`.
 *
 * Invariants: presentation only; one set of layers per actor; the foot plant, the traversal plant and the hold are
 * always there, in that order, after any other post layer.
 *
 * @example
 * // const own = layersFor(layers, id, animator, held, puppet, clipLayer, materials); // made once, kept while it fits
 * // own.traversal.pose = held.traversal; // the hands and feet on what it traverses
 * // dropLayers(own); // the actor left: its layers off, its chains freed
 * @see engine/gfx/puppets/actors.test.ts
 */
import { Actions, type ActionsState } from '../../anim/actions';
import type { Animator, AnimatorData } from '../../anim/character';
import type { ClipsData } from '../../anim/clip/clipsets';
import type { ClipLayer } from '../../anim/clip/layer';
import { FootPlant } from '../../anim/footPlant';
import type { MotionView, MovementPose } from '../../anim/locomotion/motion';
import { Reactions, type ReactionState } from '../../anim/reactions';
import { HoldPlant, type LookPose } from '../../anim/traversal/hold';
import { TraversalPlant } from '../../anim/traversal/plant';
import type { TraversalPose } from '../../anim/traversal/pose';
import { Secondary } from '../../anim/secondary';
import type { SecondaryComponent } from '../../sim/reactions';
import type { WeaponKind } from '../../world/weapons';
import { createChainMeshes, type ChainMeshes } from './chains';
import type { Puppet, PuppetMaterials } from './draw';

/** Where an actor stands: its feet (m) and heading (rad). */
export interface Place {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** What the actor puppets keep of one actor. */
export interface Held {
  before: Place;
  after: Place;
  player: boolean;
  data: AnimatorData | null;
  /** Its clip layer's data (the component `clips`), or null. */
  clips: ClipsData | null;
  puppet: Puppet | null;
  reactions: ReactionState | null;
  /** Its actions (the component `actions`, engine/sim/actorActions.ts), or null. */
  actions: ActionsState | null;
  secondary: SecondaryComponent | null;
  /** Its movement model's state (the component `motion`), which gates the foot plant's locks; null without one. */
  motion: MotionView | null;
  /** Its movement as the view shows it (the crouch, the slide, the air, the landing, the lean), eased once a step. */
  shown: MovementPose;
  /** Its traversal as the view shows it (a mantle, a climb, a ladder, a zipline, a skydive), eased once a step. */
  traversal: TraversalPose;
  /** Its look as the view shows it (`look`), eased once a step. */
  look: LookPose;
  /**
   * The weapon it has out (engine/gfx/weapons.ts `weaponOut`), or the last one it had (null: none yet): drawn in its
   * hand while its hold holds a gun, so a gun holstered stays there as the hands lower it (`HoldPlant.drawn`).
   */
  carry: WeaponKind | null;
}

/** The view's own layers on one actor's puppet animator: its reactions, its secondary motion and their meshes. */
export interface Layers {
  animator: Animator;
  key: string;
  reactions: Reactions | null;
  /** Its actions' effectors, flip and squash, on the clip layer they were made with. */
  actions: Actions | null;
  clips: ClipLayer | null;
  secondary: Secondary | null;
  chains: ChainMeshes | null;
  /** The feet on the floor, last in the post slot (engine/anim/footPlant.ts, after G9). */
  plant: FootPlant;
  /** The hands and feet on what it traverses, after the plant (engine/anim/traversal/plant.ts, WP 13.11). */
  traversal: TraversalPlant;
  /** Its head toward its look and its gun held, last (engine/anim/traversal/hold.ts, WP 13.11). */
  hold: HoldPlant;
}

/** What an actor's layers are made for: whether it has reactions and actions, and its secondary motion. */
const layersKey = (held: Held) => {
  const look = held.secondary;
  const parts = look ? [look.hair, look.cape ? 'cape' : '', look.tail ? 'tail' : ''].filter(Boolean) : [];
  const drawn = look && parts.length ? `${parts.join('+')}@${look.color}` : '';
  return `${held.reactions ? 'reactions' : ''}|${held.actions ? 'actions' : ''}|${drawn}`;
};

/** Takes `layers` off their animator and frees their meshes. */
export function dropLayers(layers: Layers): void {
  if (layers.reactions) layers.animator.drop(layers.reactions.name).drop(layers.reactions.lyingLayer.name);
  if (layers.actions) layers.animator.drop(layers.actions.name).drop(layers.actions.flipLayer.name);
  if (layers.secondary) layers.animator.drop(layers.secondary.name);
  layers.animator.drop(layers.plant.name).drop(layers.traversal.name).drop(layers.hold.name);
  layers.chains?.dispose();
}

/**
 * The layers in `layers` of actor `id`, whose puppet animator is `animator` (its clip layer `clips`): made again when
 * what they are made for changed (see the file comment), their chain meshes on `puppet`, drawn with `materials`.
 */
export function layersFor(
  layers: Map<number, Layers>,
  id: number,
  animator: Animator,
  held: Held,
  puppet: Puppet,
  clips: ClipLayer | null,
  materials: PuppetMaterials,
): Layers {
  const key = layersKey(held);
  let own = layers.get(id);
  if (own?.animator !== animator || own.key !== key || (own.actions && own.clips !== clips)) {
    if (own) dropLayers(own);
    const look = held.secondary;
    const reactions = held.reactions ? new Reactions({ name: 'view:reactions' }).attach(animator) : null;
    const actions = held.actions ? new Actions({ name: 'view:actions', ...(clips ? { clips } : {}) }).attach(animator) : null; // prettier-ignore
    const wanted = look && (look.hair || look.cape || look.tail) ? look : null;
    const secondary = wanted
      ? new Secondary({ name: 'view:secondary', squash: false, cape: wanted.cape, tail: wanted.tail, ...(wanted.hair ? { hair: wanted.hair } : {}) }) // prettier-ignore
      : null;
    if (secondary) animator.use('secondary', secondary);
    const material = materials.get(puppet.compiled.body.material);
    const chains =
      secondary && wanted ? createChainMeshes(secondary, { material, color: wanted.color, name: `actor#${id}` }) : null;
    const plant = new FootPlant({ name: 'view:footPlant' }).attach(animator);
    const traversal = new TraversalPlant({ name: 'view:traversal' }).attach(animator);
    const hold = Object.assign(new HoldPlant({ name: 'view:hold' }).follow(own?.hold).attach(animator), { contacts: traversal }); // prettier-ignore
    own = { animator, key, reactions, actions, clips, secondary, chains, plant, traversal, hold };
    layers.set(id, own);
  }
  const meshes = own.chains?.meshes ?? [];
  if (meshes.length && meshes[0].parent !== puppet.mesh) puppet.mesh.add(...meshes); // a puppet made again
  return own;
}
