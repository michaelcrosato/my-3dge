/**
 * @file Melee (PLAN.md WP 13.19; docs/PLAYGROUND.md §3.2, §7.1, §7.3): a player's punch and kicks, as Apex Legends'
 * melee. `addMelee(w)` (a scene's setup, once, after `addInteraction`) adds the system `melee` (phase `intents`, after
 * the uses, before the actors move). A `melee` press, no use held and nothing carried, swings once the hands are back
 * (`MELEE.back` after the last swing began). It swings at the nearest thing in reach that takes a strike
 * (`meleeTargets`: of the bodies a fan of rays meets across `MELEE.cone` and `MELEE.reach` from the player's axis,
 * turned where the step turns him, toward its aim, else along its look, engine/sim/hits.ts `fanHits`, a prop that
 * takes one, interact.ts `takesStrike`, or an actor with `health`), and picks
 * its move: the target's own (its strikable entry's `move`: a door's kick, `move:breach`), else from a slide the
 * uppercut, in the air the kick, else the punch (`MELEE_MOVES`). The move plays as an `Attack` (engine/anim/attack.ts),
 * its wind drawn out so its hit lands no sooner than `MELEE.lunge` after the press; until then the player lunges at
 * the target, his speed toward it set each step to close the gap to the move's own reach (engine/anim/moves.ts
 * `measureMove`) by then. While its hit window is open the swing strikes once, at the first target in reach (the one
 * it swung at while that is): an actor with `health` takes `MELEE.damage` (engine/sim/damage.ts `damage`), anything
 * else `strikeEntity`, faced only when it was the swing's target as it began (a door bursts open, then breaks: Apex's
 * rule); either asks for a `MELEE.stop` hit-stop. Each step the animator is told the move (`states.body`), so third
 * person shows it and first person's arms and kicking leg follow (engine/gfx/viewmodel/rig.ts); a hit's step
 * (`melee.hitAt`) kicks and shakes the view (engine/gfx/cameras/effects.ts).
 *
 * Events: `melee` `{ id, move, target }` as a swing begins; `strike` `{ id, target, move }` when it lands.
 *
 * Invariants: everything a swing is lives in the component `melee` (its attack's state too), so the hash, captures and
 * restores cover it: one `Attack` per move is loaded from it and saved back each step. Players in id order; rays and
 * candidates in a fixed order; no random stream.
 *
 * @example
 * // in a scene's setup, the player first: spawnPlayer(w, at); addInteraction(w); addMelee(w);
 * // session.step({ b: ['melee'] }); // a door 1.2 m ahead: the door kick; 0.83 s on it bursts open
 * // (session.world.get(1) as { melee: MeleeState }).melee.move; // 'move:breach' while it swings
 * @see engine/sim/melee.test.ts
 */
import { Attack, type AttackState } from '../anim/attack';
import { measureMove } from '../anim/moves';
import { getMove } from '../anim/moves-data';
import type { AnimatorInput } from '../anim/states';
import type { EventMap } from '../core/events';
import { defineSchema } from '../core/schema';
import { held, pressed, type Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import type { ActorComponents } from './actors';
import { damage, requestHitStop, type Health } from './damage';
import { fanHits } from './hits';
import { strikeEntity, strikeEntry, takesStrike, type InteractorComponent } from './interact';
import { entityOfBody, propOfBody, type ScenePropComponents } from './props';
import { defineComponent } from './state';
import type { World } from './world';

const DEG = Math.PI / 180;

/** Apex's melee (docs/PLAYGROUND.md §3.2): damage, reach (m) and cone (rad), the lunge, the hands back and the stop (s). */ // prettier-ignore
export const MELEE = Object.freeze({
  damage: 30,
  reach: 1.52,
  cone: 30 * DEG,
  lunge: 0.35,
  back: 0.75,
  stop: 0.25,
  /** Ours: the share of the move's reach the lunge closes to, and its top speed (m/s). */
  near: 0.9,
  most: 8,
  /** Ours: the fan's rays across the cone, and their heights over the feet (m; crouched, scaled to the eye). */
  rays: 5,
  heights: Object.freeze([0.4, 0.9, 1.4]),
});

/** The move of each melee but a target's own: the punch, the kick in the air, the uppercut from a slide. */
export const MELEE_MOVES = Object.freeze({ punch: 'move:cross', air: 'move:kick', slide: 'move:uppercut' });

/** The component `melee`'s fields (see the file comment). */
export const MELEE_FIELDS = defineSchema({
  move: { type: 'string', default: '', description: 'The move swinging, by id ("": none).' },
  attack: { type: 'object', default: {}, description: 'Its attack’s state (engine/anim/attack.ts `AttackState`).' },
  target: { type: 'integer', default: -1, minimum: -1, description: 'What it swung at as the swing began (it faced it); −1: nothing in reach.' }, // prettier-ignore
  aim: { type: 'array', items: { type: 'number' }, default: [0, 0, 0], unit: 'm', description: 'Where on the target it swung at, from the target’s place.' }, // prettier-ignore
  close: { type: 'number', default: 0, minimum: 0, unit: 'm', description: 'How near that point the lunge brings its axis: the move’s reach.' }, // prettier-ignore
  began: { type: 'integer', default: -1, minimum: -1, description: 'The step the swing began; −1: never.' },
  lands: { type: 'integer', default: -1, minimum: -1, description: 'The step its hit window opens: the lunge’s end.' },
  struck: { type: 'integer', default: -1, minimum: -1, description: 'What this swing struck; −1: nothing yet.' },
  hitAt: { type: 'integer', default: -1, minimum: -1, description: 'The step its last hit landed (the view’s kick and shake); −1: never.' }, // prettier-ignore
});

/** A player's swing (`MELEE_FIELDS` says what each field means). */
export interface MeleeState {
  move: string;
  attack: AttackState | Record<string, never>;
  target: number;
  aim: [number, number, number];
  close: number;
  began: number;
  lands: number;
  struck: number;
  hitAt: number;
}

defineComponent('melee', { description: 'A player’s melee swing (WP 13.19).', fields: MELEE_FIELDS });

/** A player as this module reads him. */
type Player = ActorComponents & {
  id: number;
  melee?: MeleeState;
  interactor?: InteractorComponent;
  motion?: { sliding?: boolean; mode?: string; duck?: string };
  animator?: { build: string; weapon: string; states: Partial<AnimatorInput> };
};

/** What a swing may land on: a prop, or an actor with its health. */
type Target = Partial<ActorComponents> & Partial<ScenePropComponents> & { health?: Health };

/** Adds the system `melee` to `w` (once): see the file comment. */
export function addMelee<C extends object, E extends EventMap>(world: World<C, E>): void {
  const w = world as unknown as World;
  if (!w.systems.has('melee')) w.systems.add('melee', stepMelee, { phase: 'intents' });
}

/** One `Attack` per move, its wind drawn out so its hit lands no sooner than `MELEE.lunge` (loaded from each swing). */
const attacks = new Map<string, Attack>();

/** The attack playing `move` (see `attacks`). */
function attackFor(move: string): Attack {
  let attack = attacks.get(move);
  if (!attack) {
    const m = getMove(move);
    const wind = Math.max(m.time.wind, MELEE.lunge - m.hitAt * m.time.active);
    attacks.set(move, (attack = new Attack(m, { time: { wind } })));
  }
  return attack;
}

/** Where `t` stands (m): an actor's feet, a prop's centre. */
function placeOf(t: Target): [number, number, number] {
  return t.actor ? [t.actor.x, t.actor.y, t.actor.z] : [t.sceneProp!.x, t.sceneProp!.y, t.sceneProp!.z];
}

/** What a melee reached: the entity, and the point its ray met (m). */
export interface MeleeReach {
  readonly id: number;
  readonly point: readonly [number, number, number];
}

/**
 * What the player actor `id` reaches with a melee now, facing `yaw` (rad; his own by default), nearest first (see the
 * file comment): each entity once, a prop that takes a strike or an actor with health, behind no wall.
 */
export function meleeTargets<C extends object, E extends EventMap>(
  world: World<C, E>,
  id: number,
  yaw?: number,
): MeleeReach[] {
  const w = world as unknown as World;
  const e = w.get(id) as unknown as Player;
  const { x, y, z, body } = e.actor;
  const ducked = e.motion?.duck === 'ducked' || e.motion?.duck === 'ducking';
  const heights = MELEE.heights.map((h) => (ducked ? h * 0.55 : h));
  const fan = { reach: MELEE.reach, cone: MELEE.cone, rays: MELEE.rays, heights };
  const found: MeleeReach[] = [];
  for (const hit of fanHits(physicsOf(w), [x, y, z], yaw ?? e.actor.yaw, fan, { exclude: body })) {
    const prop = propOfBody(w, hit.body);
    const other = entityOfBody(w, hit.body);
    if (other < 0 || found.some((f) => f.id === other)) continue;
    const health = (w.get(other) as unknown as Target).health;
    if (prop >= 0 ? takesStrike(w, prop) : !!health && health.hp > 0) found.push({ id: other, point: hit.point });
  }
  return found;
}

/** Whether `melee` may swing at step `tick`: no swing playing, and the hands back from the last. */
const ready = (melee: MeleeState, tick: number, dt: number) => melee.move === '' && (melee.began < 0 || (tick - melee.began) * dt >= MELEE.back - 1e-9); // prettier-ignore

/** Begins a swing for the player `e` (see the file comment). */
function begin(w: World, e: Player, melee: MeleeState, yaw: number): void {
  const target = meleeTargets(w, e.id, yaw)[0];
  const own = target ? strikeEntry(w, target.id)?.move : '';
  const move = own || (e.motion?.sliding ? MELEE_MOVES.slide : !e.actor.grounded ? MELEE_MOVES.air : MELEE_MOVES.punch);
  const attack = attackFor(move);
  attack.cancel(); // shared by every swing of this move: whatever it last held, it begins afresh
  attack.start();
  const { wind, active } = attack.move.time;
  const place = target ? placeOf(w.get(target.id) as unknown as Target) : null;
  const look = { build: e.animator?.build ?? 'build:adult', weapon: (e.animator?.weapon ?? 'none') as 'none' };
  Object.assign(melee, {
    move,
    attack: attack.save(),
    target: target ? target.id : -1,
    aim:
      target && place
        ? [target.point[0] - place[0], target.point[1] - place[1], target.point[2] - place[2]]
        : [0, 0, 0],
    close: measureMove(move, look).range * MELEE.near,
    began: w.tick,
    lands: w.tick + Math.max(0, Math.ceil((wind + attack.move.hitAt * active) / w.dt - 1e-6) - 1),
    struck: -1,
  });
  w.emit('melee', { id: e.id, move, target: melee.target });
}

/** Sets the player's speed toward the swing's target to close the gap to its reach by the hit (see the file comment). */
function lunge(w: World, e: Player, melee: MeleeState): void {
  const target = w.get(melee.target) as unknown as Target | undefined;
  if (!target || (!target.actor && !target.sceneProp) || w.tick > melee.lands) return;
  const place = placeOf(target);
  const [dx, dz] = [place[0] + melee.aim[0] - e.actor.x, place[2] + melee.aim[2] - e.actor.z];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  const [ux, uz] = [dx / d, dz / d];
  const steps = melee.lands - w.tick;
  const speed = steps > 0 ? Math.min(MELEE.most, Math.max(0, d - melee.close) / (steps * w.dt)) : 0;
  const along = e.actor.vx * ux + e.actor.vz * uz;
  [e.actor.vx, e.actor.vz] = [e.actor.vx + (speed - along) * ux, e.actor.vz + (speed - along) * uz];
}

/** Lands the swing on the first target in reach, the one it swung at while that is (see the file comment). */
function land(w: World, e: Player, melee: MeleeState, yaw: number): void {
  const reached = meleeTargets(w, e.id, yaw);
  const hit = reached.find((r) => r.id === melee.target) ?? reached[0];
  if (!hit) return;
  const target = w.get(hit.id) as unknown as Target;
  const from: [number, number, number] = [e.actor.x, e.actor.y + 1, e.actor.z];
  if (target.sceneProp) {
    strikeEntity(w, hit.id, from, hit.id === melee.target, 'melee');
    requestHitStop(w, MELEE.stop);
  } else damage(w, { id: hit.id, health: target.health }, { amount: MELEE.damage, from, at: hit.point, source: e.id, stop: MELEE.stop }); // prettier-ignore
  [melee.struck, melee.hitAt] = [hit.id, w.tick];
  w.emit('strike', { id: e.id, target: hit.id, move: melee.move });
}

/** Where the player faces this step: toward the aim, else along the look, as the movement model turns him; else his own. */ // prettier-ignore
function facing(e: Player, intents: Intents): number {
  const [x, , z] = intents.aim ?? [];
  if (x !== undefined && Math.hypot(x - e.actor.x, z! - e.actor.z) > 0.05) return Math.atan2(x - e.actor.x, z! - e.actor.z); // prettier-ignore
  return intents.look?.[0] ?? e.actor.yaw;
}

/** The system `melee`: each player's swing, in id order (see the file comment). */
function stepMelee(w: World, intents: Intents): void {
  for (const e of w.query('actor') as unknown as Player[]) {
    if (!e.actor.player) continue;
    const melee = e.melee ?? (w.add(e.id, 'melee' as never) as unknown as MeleeState);
    e.melee = melee;
    const free = !held(intents, 'interact') && (e.interactor?.holding ?? -1) < 0;
    const footing = !e.motion?.mode || e.motion.mode === 'ground' || e.motion.mode === 'air';
    const yaw = facing(e, intents);
    if (pressed(intents, 'melee') && free && footing && ready(melee, w.tick, w.dt)) begin(w, e, melee, yaw);
    const states = e.animator?.states;
    if (melee.move === '') {
      if (states) delete states.body;
      continue;
    }
    const attack = attackFor(melee.move).load(melee.attack as AttackState);
    attack.update(w.dt);
    if (melee.struck < 0) lunge(w, e, melee);
    if (attack.hitOpen && melee.struck < 0) land(w, e, melee, yaw);
    if (states && attack.busy) states.body = { move: melee.move, phase: attack.phase!, u: attack.u };
    else if (states) delete states.body;
    [melee.attack, melee.move] = attack.busy ? [attack.save(), melee.move] : [{}, ''];
  }
}
