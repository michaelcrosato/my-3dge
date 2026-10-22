/**
 * @file Use (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1): what a player's `interact` press uses, and what a strike does.
 * `addInteraction(w)` (a scene's setup, once) adds the system `interact` (phase `intents`, before the actors move and
 * before the doors, the panes and the switches, phase `anim`; the dev action `freeze` stops none of them). Each step
 * it finds, for every player actor, the usable thing in reach (`USE_REACH`, 2 m from its eye) and in view: along its
 * crosshair when the step has a `look` and an `aim` (first person and the shooter), the first body the eye's ray toward
 * the aim strikes, or a bodiless thing (a switch) it passes within `BODILESS` of before that; else the nearest within
 * 60° of where it faces, a wall, a door or a pane between hiding one. Only what can be used now counts (a sliding door
 * hides no switch). It keeps that thing and its prompt in the actor's `interactor` component, which the page shows with
 * the binding of the device used last.
 *
 * Usable things are asked of their entries, never their ids: `defineUsable(component, { prompt, use })` says how an
 * entity holding that component is used (a door: engine/sim/doors.ts; a switch: switches.ts), and a prop is usable when
 * its own `use` has a `prompt`, or when a player can carry it (dynamic, at most `CARRY_MASS`). Its `use` hook gets the
 * world, the entity and the user. A carried prop's body is driven 0.8 m in front of the eye each step (it still
 * collides, and drops when held back past the reach and 1.5 m); the next use throws it along the view at `THROW_SPEED`.
 * A strike (`strikeEntity`: a melee hit, engine/sim/melee.ts; a shot; a blast) lands on what takes one, the kind
 * `strikable` by component (`defineStrikable(component, strike, move?)`: a door bursts open, then breaks; a breakable
 * prop takes a point of damage; a thing a point), else a dynamic prop is knocked; a lamp or a switch takes none. The
 * entry may name the move a melee plays on it (a door's kick: `strikeEntry`).
 *
 * A use takes its press: `interactor.usedAt` is the step, and the actors' input leaves it out of the rides'
 * (engine/sim/actorInput.ts), so using a door beside a zipline does not ride it. Events: `use` `{ id, target }`,
 * `pickup` and `throw` (the same).
 *
 * Invariants: everything is in components (the interactor, the props', the doors'); candidates in id order, the
 * nearest first among them, ties to the lower id; the queries read the physics world as of the last step; a body's prop
 * is found by a scan of the props (`propOfBody`), never an index kept beside them.
 * @see engine/sim/interact.test.ts
 */
import type { EventMap } from '../core/events';
import { Vector3 } from '../core/math';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { pressed, type Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import { getProp, type Prop } from '../world/props/prop';
import type { ActorComponents } from './actors';
import { hitProp, propOfBody, type ScenePropComponents } from './props';
import { defineComponent } from './state';
import type { World } from './world';

/** How far from the eye a thing is in reach (m). */
export const USE_REACH = 2;
/** The heaviest prop a player carries (kg): a chair, a box, a crate. */
export const CARRY_MASS = 25;
/** How fast a carried prop leaves when it is thrown (m/s). */
export const THROW_SPEED = 8;
/** The eye over the feet, standing and crouched (m): the cameras' (engine/gfx/cameras/effects.ts). */
const EYE = { stand: 1.52, crouch: 0.81 } as const;
/** How far in front of the eye a carried prop is held (m), and how much farther than the reach it may lag before it drops. */
const HOLD = { ahead: 0.8, slip: 1.5 } as const;
/** The cosine of the widest angle from where a player faces that is "in front" (60°), written out: no Math at import. */
const FRONT = 0.5;
/** How near a bodiless thing (a switch on a wall) the crosshair's ray must pass to be on it (m). */
export const BODILESS = 0.15;

/** How an entity holding a component is used: what the HUD says (null: not now) and what using it does. */
export interface UsableSpec {
  prompt(w: World, id: number, user: number): string | null;
  use(w: World, id: number, user: number): void;
}

/** The component `interactor`: what a player would use, its prompt, what it carries, and when it last used. */
export interface InteractorComponent {
  target: number;
  prompt: string;
  holding: number;
  usedAt: number;
}

/** Declares the kinds `usable` and `strikable` and the component `interactor` on `registry` (once). */
export function defineInteractKinds(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('usable')) return;
  registry.defineKind('usable', {
    description: 'How an entity holding a component is used (doors, switches): its prompt and its use (WP 13.16).',
    fields: {
      prompt: { type: 'function', default: () => null, description: '(w, id, user) => the HUD’s words, or null.' },
      use: { type: 'function', default: () => {}, description: '(w, id, user) => void: what using it does.' },
    },
    defineWith: "defineUsable('<component>', { prompt(w, id, user), use(w, id, user) })",
  });
  registry.defineKind('strikable', {
    description: 'How an entity holding a component takes a strike (doors, breakables, WP 13.16).',
    fields: {
      strike: { type: 'function', default: () => {}, description: '(w, id, from, faced, force) => void.' },
      move: {
        type: 'string',
        default: '',
        description: 'The move a melee plays on it (a door’s kick); "": the usual.',
      },
    },
    defineWith: "defineStrikable('<component>', (w, id, from, faced, force) => { … }, 'move:<id>')",
  });
  const int = (description: string) => ({ type: 'integer', default: -1, minimum: -1, description }) as const;
  const fields = {
    target: int('The entity it would use now; −1: none.'),
    prompt: { type: 'string', default: '', description: 'What using it does, for the HUD.' },
    holding: int('The prop it carries; −1: none.'),
    usedAt: int('The step it last used something on (its press is not a ride’s then).'),
  } as const;
  defineComponent('interactor', { description: 'A player’s use (WP 13.16).', fields }, registry);
}
defineInteractKinds();

/** Says how an entity holding `component` is used (see the file comment), on the shared registry the system reads. */
export function defineUsable(component: string, spec: UsableSpec): void {
  defineInteractKinds();
  sharedRegistry.def('usable', component, spec as unknown as Record<string, unknown>);
}

type Entity = ActorComponents & ScenePropComponents & { id: number; interactor?: InteractorComponent };

/** Adds the system `interact` to `w` (once): see the file comment. */
export function addInteraction<C extends object, E extends EventMap>(world: World<C, E>): void {
  const w = world as unknown as World;
  if (!w.systems.has('interact')) w.systems.add('interact', interact, { phase: 'intents' });
}

/** A prop's mass (kg) as its body weighs it; 0 without a dynamic body. */
function massOf(prop: Prop): number {
  const { type, shape, size, radius, height, density } = prop.body;
  if (type !== 'dynamic') return 0;
  const volume = shape === 'box' ? size[0] * size[1] * size[2] : shape === 'ball' ? (4 / 3) * Math.PI * Math.pow(radius, 3) : Math.PI * radius * radius * height + (shape === 'capsule' ? (4 / 3) * Math.PI * Math.pow(radius, 3) : 0); // prettier-ignore
  return density * volume;
}

/** How far from its centre a thing is aimed at (m): half its body's widest size, 0.15 m without one. */
function radiusOf(prop: Prop): number {
  const { type, shape, size, radius } = prop.body;
  if (type === 'none') return 0.15;
  return shape === 'box' ? Math.max(size[0], size[1], size[2]) / 2 : radius;
}

/** The usable entry of the entity, its own use, carrying, or null. */
function usableOf(w: World, e: Entity): UsableSpec | 'carry' | Prop | null {
  for (const entry of sharedRegistry.list('usable') as unknown as (UsableSpec & { id: string })[]) {
    if ((e as unknown as Record<string, unknown>)[entry.id] !== undefined) return entry;
  }
  if (!e.sceneProp) return null;
  const prop = getProp(e.sceneProp.prop);
  if (prop.prompt) return prop;
  return massOf(prop) > 0 && massOf(prop) <= CARRY_MASS ? 'carry' : null;
}

/** Whether nothing of the world (walls, doors, fixed props) stands between `eye` and `at`, `body` aside. */
function clear(w: World, eye: Vector3, at: Vector3, body: number): boolean {
  const way = at.clone().sub(eye);
  const far = way.length();
  if (far < 1e-6) return true;
  const hit = physicsOf(w).raycast(eye, way.divideScalar(far), { groups: 'world', maxDistance: far, ...(body >= 0 ? { exclude: body } : {}) }); // prettier-ignore
  return !hit || hit.distance >= far - 0.05;
}

/** The thing `actor` would use or strike, of those `accept` takes (see the file comment); −1 for none. */
function findTarget(w: World, actor: Entity, wants: Intents, accept: (e: Entity) => boolean): number {
  const { x, y, z } = actor.actor;
  const crouched = (actor as { motion?: { stance?: string } }).motion?.stance === 'crouch';
  const eye = new Vector3(x, y + (crouched ? EYE.crouch : EYE.stand), z);
  const aim = wants.look && wants.aim ? new Vector3(...wants.aim).sub(eye) : null;
  if (aim && aim.lengthSq() > 1e-6) return alongRay(w, eye, aim.normalize(), accept);
  const facing = new Vector3(Math.sin(actor.actor.yaw), 0, Math.cos(actor.actor.yaw));
  let [best, score] = [-1, Infinity];
  for (const e of w.query('sceneProp') as unknown as Entity[]) {
    // Where it is first, then whether it can be used: a house holds hundreds of props, few of them in reach.
    const at = new Vector3(e.sceneProp.x, e.sceneProp.y, e.sceneProp.z);
    const to = at.clone().sub(eye);
    if (to.length() > USE_REACH + radiusOf(getProp(e.sceneProp.prop))) continue;
    const flat = new Vector3(to.x, 0, to.z);
    const distance = flat.length();
    if (distance > 1e-6 && flat.divideScalar(distance).dot(facing) < FRONT) continue;
    if (to.length() < score && accept(e) && clear(w, eye, at, e.sceneProp.body)) [best, score] = [e.id, to.length()];
  }
  return best;
}

/**
 * Along the crosshair's `ray` from `eye`: the prop whose body the ray strikes first within reach, or a bodiless one it
 * passes within BODILESS of before that (a switch on that wall's face counts: 5 cm of grace), when `accept` takes it.
 */
function alongRay(w: World, eye: Vector3, ray: Vector3, accept: (e: Entity) => boolean): number {
  const hit = physicsOf(w).raycast(eye, ray, { groups: ['world', 'prop'], maxDistance: USE_REACH });
  const struck = hit ? propOfBody(w, hit.body) : -1;
  let [best, score] = [-1, hit ? hit.distance + 0.05 : USE_REACH];
  if (struck >= 0 && accept(w.get(struck) as unknown as Entity)) [best, score] = [struck, hit!.distance];
  for (const e of w.query('sceneProp') as unknown as Entity[]) {
    if (e.sceneProp.body >= 0 || !accept(e)) continue;
    const to = new Vector3(e.sceneProp.x, e.sceneProp.y, e.sceneProp.z).sub(eye);
    const along = to.dot(ray);
    if (along > 0 && along < score && to.addScaledVector(ray, -along).length() <= BODILESS) [best, score] = [e.id, along]; // prettier-ignore
  }
  return best;
}

/** What `usable` says using `id` does, for `user`; null when it cannot be used now. */
function promptOf(w: World, usable: UsableSpec | 'carry' | Prop, id: number, user: number): string | null {
  if (usable === 'carry') return 'Pick up';
  if ('id' in usable && (usable as Prop).kind === 'prop') return (usable as Prop).prompt;
  return (usable as UsableSpec).prompt(w, id, user);
}

/** Uses `id` as `usable` says, for actor `user`. */
function useOne(w: World, usable: UsableSpec | 'carry' | Prop, id: number, user: Entity): void {
  const interactor = user.interactor!;
  if (usable === 'carry') {
    interactor.holding = id;
    w.emit('pickup', { id: user.id, target: id });
    return;
  }
  if ((usable as Prop).kind === 'prop') {
    const prop = usable as Prop;
    const data = (w.get(id) as unknown as Entity).sceneProp;
    prop.use({ prop, body: data.body, from: [user.actor.x, user.actor.y, user.actor.z], world: w, entity: id, user: user.id, knock: () => {} }); // prettier-ignore
  } else (usable as UsableSpec).use(w, id, user.id);
  w.emit('use', { id: user.id, target: id });
}

/** Drives the prop `actor` carries in front of its eye, or drops it; throws it on a use press. */
function carry(w: World, actor: Entity, wants: Intents, throwIt: boolean): void {
  const interactor = actor.interactor!;
  const held = w.get(interactor.holding) as unknown as Entity | undefined;
  if (!held?.sceneProp || held.sceneProp.body < 0) return void (interactor.holding = -1);
  const physics = physicsOf(w);
  const { x, y, z } = actor.actor;
  const [yaw, pitch] = wants.look ?? [actor.actor.yaw, 0];
  const view = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const at = new Vector3(x, y + EYE.stand, z).addScaledVector(view, HOLD.ahead);
  const body = physics.readBody(held.sceneProp.body);
  if (throwIt) {
    physics.setBody(held.sceneProp.body, { velocity: view.multiplyScalar(THROW_SPEED), angularVelocity: [0, 0, 0] });
    w.emit('throw', { id: actor.id, target: interactor.holding });
    return void (interactor.holding = -1);
  }
  if (body.position.distanceTo(at) > USE_REACH + HOLD.slip) return void (interactor.holding = -1); // held back
  const velocity = at.sub(body.position).multiplyScalar(1 / w.dt);
  physics.setBody(held.sceneProp.body, { velocity: velocity.clampLength(0, 12), angularVelocity: [0, 0, 0] });
}

/** What strikes: a melee hit, a shot or a blast (a door bursts open at a hit, breaks at a shot or a blast). */
export type StrikeForce = 'melee' | 'shot' | 'blast';

/** How an entity holding a component takes a strike (`defineStrikable`). */
type Strike = (w: World, id: number, from: readonly [number, number, number], faced: boolean, force: StrikeForce) => void; // prettier-ignore

/** A `strikable` entry: how an entity holding its component (`id`) takes a strike, and the move a melee plays on it. */
export interface StrikeEntry {
  readonly id: string;
  readonly strike: Strike;
  readonly move: string;
}

/** The `strikable` entry of a component `e` holds, or undefined. */
function strikeOf(e: Entity): StrikeEntry | undefined {
  const entries = sharedRegistry.list('strikable') as unknown as StrikeEntry[];
  return entries.find((entry) => (e as unknown as Record<string, unknown>)[entry.id] !== undefined);
}

/** The `strikable` entry of a component the entity `id` holds (a door's), or undefined. */
export function strikeEntry<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
): StrikeEntry | undefined {
  const e = (world as unknown as World).get(id) as unknown as Entity | undefined;
  return e ? strikeOf(e) : undefined;
}

/** Whether the prop entity `id` takes a strike: a strikable component, health, or a dynamic body to knock. */
export function takesStrike<C extends object, E extends EventMap>(world: World<C, E>, id: number): boolean {
  const e = (world as unknown as World).get(id) as unknown as Entity | undefined;
  if (!e?.sceneProp) return false;
  return !!strikeOf(e) || !!e.propHealth || getProp(e.sceneProp.prop).body.type === 'dynamic';
}

/**
 * Strikes `target` from `from` (m), its striker facing it or not (`faced`), with `force`: the entry of a component it
 * holds answers (a door's rule: engine/sim/doors.ts; a breakable's damage: breakables.ts), else a dynamic prop is
 * knocked (its `hit` hook).
 */
export function strikeEntity<C extends object, E extends EventMap>(
  world: World<C, E>,
  target: number,
  from: readonly [number, number, number],
  faced = true,
  force: StrikeForce = 'melee',
): void {
  // prettier-ignore
  const w = world as unknown as World;
  const e = w.get(target) as unknown as Entity | undefined;
  if (!e?.sceneProp) return;
  const entry = strikeOf(e);
  if (entry) return entry.strike(w, target, from, faced, force);
  hitProp(w, target, [from[0], from[1], from[2]]);
}

/** The system `interact`: every player actor's use, carry and strike, in id order. */
function interact(w: World, intents: Intents): void {
  for (const actor of w.query('actor') as unknown as Entity[]) {
    if (!actor.actor.player) continue;
    const interactor = actor.interactor ?? (w.add(actor.id, 'interactor' as never) as unknown as InteractorComponent);
    actor.interactor = interactor;
    const use = pressed(intents, 'interact');
    if (interactor.holding >= 0) {
      carry(w, actor, intents, use);
      if (use) interactor.usedAt = w.tick;
      [interactor.target, interactor.prompt] = [interactor.holding, interactor.holding >= 0 ? 'Throw' : ''];
      continue;
    }
    const usableNow = (e: Entity) => {
      const usable = usableOf(w, e);
      return usable !== null && promptOf(w, usable, e.id, actor.id) !== null;
    };
    const target = findTarget(w, actor, intents, usableNow);
    const usable = target >= 0 ? usableOf(w, w.get(target) as unknown as Entity) : null;
    const prompt = usable ? promptOf(w, usable, target, actor.id) : null;
    [interactor.target, interactor.prompt] = prompt === null ? [-1, ''] : [target, prompt];
    if (use && usable && prompt !== null) {
      useOne(w, usable, target, actor);
      interactor.usedAt = w.tick;
      const after = interactor.holding >= 0 ? 'Throw' : w.has(target) ? promptOf(w, usable, target, actor.id) : null;
      [interactor.target, interactor.prompt] = after === null ? [-1, ''] : [target, after]; // what the HUD shows now
    }
  }
}

/**
 * Says how an entity holding `component` takes a strike (doors, breakables), on the shared registry: before the
 * default knock; `move`, the move a melee plays on it (a door's kick, `move:breach`), when not the usual.
 */
export function defineStrikable(component: string, strike: Strike, move = ''): void {
  defineInteractKinds();
  sharedRegistry.def('strikable', component, { strike, move });
}
