/**
 * @file Firearms in a scene (PLAN.md WP 13.20; docs/PLAYGROUND.md §7.2): a player carries weapons (the kind `weapon`,
 * engine/world/weapons.ts) in the component `weapons` (`weaponsFor(slots)`, given at spawn: engine/sim/actors.ts's
 * `components`), and the system `weapons` (phase `intents`, after the uses and melee; `addWeapons(w)`, once) plays
 * them, players in id order:
 * - **Drawing and holstering**: `weapon1` and `weapon2` draw a slot, `swap` the other, `holster` puts the weapon away
 *   and draws it again, and the trigger draws one holstered; each takes the weapon's `draw` seconds. Holstered, he
 *   runs on the movement model's holstered speeds (Apex's ×1.15: `motion.holstered`), and his body carries a gun or
 *   nothing (the animator's `weapon`). A melee swing holds the trigger until the hands are back (`MELEE.back`).
 * - **Aiming down the sights** (`aim` held, a weapon out, on foot or in the air): the sights come up over `sights`
 *   seconds (`weapons.aim`), the cone narrowing toward `spread.ads`, and he walks (engine/sim/actorInput.ts).
 * - **Firing** (`fire`: pressed, or held for an automatic one) at the weapon's rate, a round a shot, the magazine's
 *   last bringing the reload on; an empty one clicks (`dry`) and reloads. A shot is hitscan (the physics world's
 *   raycast, `range` long, his own body aside): from his eye toward the step's `aim` when it has a `look` (first
 *   person and the shooter: the crosshair's point), else along the look; without a look, level from his chest toward
 *   the aim (isometric's and top-down's pointer) or where he faces; turned in the aim's own frame (so a cone stays
 *   round at any pitch) by the burst's kick so far and a spread (`spreadOf`) drawn from his stream `weapon`. What it
 *   meets takes it: a person `damage` (engine/sim/damage.ts), a
 *   prop a strike (interact.ts `strikeEntity`, `shot`: a thing a point, a door broken, a pane a point, a dynamic prop
 *   knocked). `shots` and `hits` (a thing standing, a person alive) keep the range's count.
 * - **Reloading** (`reload`, the magazine not full; or at its last round): `reload.tactical` seconds, `reload.empty`
 *   from empty, no shot meanwhile; drawing another or holstering cancels it.
 * - **The kick**: each shot adds its recoil step (`recoilStep`) to `weapons.kick`, degrees up and right, so a burst
 *   climbs; `settle` seconds after the last shot the burst ends and the kick falls away (`recover`, a time constant).
 *   The view tilts the camera by it as it is, so the picture's centre is where the next shot goes.
 *
 * Events: `gunshot` `{ id, weapon, from, to, normal, body, target, hit }` (a miss: `normal` null, `body` and `target`
 * −1, `to` the shot's end), `draw`, `holster`, `reload` and `dry` `{ id, weapon }`.
 *
 * Invariants: everything is in the component (times are the sim's, `w.time`); the spread draws only from
 * `w.rng.entity(id, 'weapon')`; a weapon is asked of its entry. Problems raise `CORE_BAD_SPEC`.
 *
 * @example
 * // defineWeapon('weapon:pistol', { rate: 6, damage: 18, magazine: 12 });
 * // spawnActor(w, { at, character, components: { weapons: weaponsFor(['weapon:pistol']) } }); addWeapons(w);
 * // session.step({ b: ['weapon1'] }); … session.step({ look: [0, 0], b: ['fire'] }); // a `gunshot` event
 * @see engine/sim/weapons.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError } from '../core/log';
import { defineSchema } from '../core/schema';
import { held, pressed, type Intents } from '../input/intents';
import { physicsOf } from '../physics/binding';
import type { GroupName } from '../physics/groups';
import { getWeapon, recoilStep, spreadOf, type WeaponKind } from '../world/weapons';
import type { ActorComponents } from './actors';
import { damage, type Health } from './damage';
import { EYE, strikeEntity } from './interact';
import { MELEE, type MeleeState } from './melee';
import { entityOfBody } from './props';
import { defineComponent } from './state';
import type { World } from './world';

const DEG = Math.PI / 180;

/** The component `weapons`' fields (see the file comment). */
export const WEAPONS_FIELDS = defineSchema({
  slots: { type: 'array', items: { type: 'string' }, default: [], description: 'The weapons carried, by id, in slot order.' }, // prettier-ignore
  slot: { type: 'integer', default: -1, minimum: -1, description: 'The slot out (−1: holstered).' },
  last: { type: 'integer', default: 0, minimum: 0, description: 'The slot drawn last: what `holster` draws again.' },
  mags: { type: 'array', items: { type: 'number' }, default: [], description: 'Rounds in each slot’s magazine.' },
  ready: { type: 'number', default: 0, unit: 's', description: 'When the weapon out is ready to fire: its draw done (a swing holds the trigger apart: MELEE.back).' }, // prettier-ignore
  next: { type: 'number', default: 0, unit: 's', description: 'When its rate lets it fire again.' },
  reload: { type: 'number', default: -1, unit: 's', description: 'When the reload under way ends (−1: none).' },
  burst: { type: 'integer', default: 0, minimum: 0, description: 'Shots in the burst under way.' },
  kick: { type: 'array', items: { type: 'number' }, default: [0, 0], unit: 'deg', description: 'The burst’s kick so far, [up, right].' }, // prettier-ignore
  shot: { type: 'number', default: -1, unit: 's', description: 'When it last fired (−1: never).' },
  shots: { type: 'integer', default: 0, minimum: 0, description: 'Shots fired, all told.' },
  hits: { type: 'integer', default: 0, minimum: 0, description: 'Shots that struck a target: a thing standing, a person alive.' }, // prettier-ignore
  aim: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'How far the sights are up, 0 to 1.' },
});

/** A player's weapons (`WEAPONS_FIELDS` says what each field means). */
export interface WeaponsState {
  slots: string[];
  slot: number;
  last: number;
  mags: number[];
  ready: number;
  next: number;
  reload: number;
  burst: number;
  kick: [number, number];
  shot: number;
  shots: number;
  hits: number;
  aim: number;
}

defineComponent('weapons', { description: 'The weapons a player carries and how they stand (WP 13.20).', fields: WEAPONS_FIELDS }); // prettier-ignore

/** A player's weapons component carrying `slots` (weapon ids), each magazine full, holstered unless `drawn`. */
export function weaponsFor(slots: readonly string[], drawn = -1): WeaponsState {
  if (!slots.length || drawn < -1 || drawn >= slots.length) throw codeError('CORE_BAD_SPEC', { where: 'weaponsFor(slots, drawn)', problems: `${JSON.stringify(slots)}, ${drawn}: give a weapon or more and a slot of them (−1: holstered)` }); // prettier-ignore
  const mags = slots.map((id) => getWeapon(id).magazine);
  return { slots: [...slots], slot: drawn, last: Math.max(0, drawn), mags, ready: 0, next: 0, reload: -1, burst: 0, kick: [0, 0], shot: -1, shots: 0, hits: 0, aim: 0 }; // prettier-ignore
}

/** Adds the system `weapons` to `w` (once): see the file comment. */
export function addWeapons<C extends object, E extends EventMap>(world: World<C, E>): void {
  const w = world as unknown as World;
  if (!w.systems.has('weapons')) w.systems.add('weapons', stepWeapons, { phase: 'intents' });
}

/** A player as this module reads him. */
type Player = ActorComponents & {
  id: number;
  weapons: WeaponsState;
  melee?: MeleeState;
  motion?: { mode?: string; stance?: string; holstered?: boolean };
  animator?: { weapon: string };
};

/** The groups a shot meets: the level, props, people and crowds. */
const SHOT_GROUPS: readonly GroupName[] = ['world', 'prop', 'actor', 'crowd', 'flyer'];
/**
 * How high a shot leaves the chest without a look (m over the feet; crouched): isometric's, top-down's, the
 * platformer's. The view meets the pointer's ray at this height (engine/app/view.ts), so the pointer over a body aims
 * at it.
 */
export const CHEST = { stand: 1.3, crouch: 0.75 } as const;
/** The moves he may fire in: on foot and in the air (his hands are on a ledge, a wall, a rung or the cable otherwise). */
const FIRING = new Set(['ground', 'air']);

/** Draws slot `slot` (see the file comment). */
function draw(w: World, e: Player, slot: number): void {
  const W = e.weapons;
  const kind = getWeapon(W.slots[slot]);
  [W.slot, W.last, W.ready, W.reload, W.burst, W.kick] = [slot, slot, w.time + kind.draw, -1, 0, [0, 0]];
  w.emit('draw', { id: e.id, weapon: kind.id });
}

/** Puts the weapon out away (see the file comment). */
function holster(w: World, e: Player): void {
  const W = e.weapons;
  const kind = getWeapon(W.slots[W.slot]);
  [W.slot, W.ready, W.reload, W.burst, W.kick, W.aim] = [-1, w.time + kind.draw, -1, 0, [0, 0], 0];
  w.emit('holster', { id: e.id, weapon: kind.id });
}

/** Where a shot of `e` leaves and the way it goes before its kick and spread (see the file comment). */
function aimOf(e: Player, intents: Intents): { from: [number, number, number]; yaw: number; pitch: number } {
  const { x, y, z, yaw } = e.actor;
  const crouched = e.motion?.stance === 'crouch';
  const [ax, ay, az] = intents.aim ?? [];
  if (intents.look) {
    const from: [number, number, number] = [x, y + (crouched ? EYE.crouch : EYE.stand), z];
    const [dx, dy, dz] = ax === undefined ? [0, 0, 0] : [ax - from[0], ay! - from[1], az! - from[2]];
    const flat = Math.hypot(dx, dz);
    if (Math.hypot(flat, dy) > 0.5) return { from, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, flat) };
    return { from, yaw: intents.look[0], pitch: intents.look[1] };
  }
  const from: [number, number, number] = [x, y + (crouched ? CHEST.crouch : CHEST.stand), z];
  const toward = ax !== undefined && Math.hypot(ax - x, az! - z) > 0.05;
  return { from, yaw: toward ? Math.atan2(ax - x, az! - z) : yaw, pitch: 0 };
}

/**
 * The way `up` rad above and `right` rad to the right of the aim (`yaw`, `pitch`) goes, turned in the aim's own frame
 * (its forward, his right, and the up across them), so a cone of offsets stays round at any pitch.
 */
function turned(yaw: number, pitch: number, up: number, right: number): [number, number, number] {
  const [sy, cy, sp, cp] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch)];
  const [f, r, u] = [[sy * cp, sp, cy * cp], [-cy, 0, sy], [-sy * sp, cp, -cy * sp]]; // prettier-ignore
  const t = Math.hypot(up, right);
  const [c, k] = t < 1e-12 ? [1, 0] : [Math.cos(t), Math.sin(t) / t];
  return [0, 1, 2].map((i) => f[i] * c + (u[i] * up + r[i] * right) * k) as [number, number, number];
}

/** Fires one shot of `kind` from `e` (see the file comment). */
function shoot(w: World, e: Player, kind: WeaponKind, intents: Intents): void {
  const W = e.weapons;
  const { from, yaw, pitch } = aimOf(e, intents);
  const spread = spreadOf(kind, W.aim, Math.hypot(e.actor.vx, e.actor.vz) > 0.5);
  const rng = w.rng.entity(e.id, 'weapon');
  const [turn, out] = [rng.next() * 2 * Math.PI, spread * Math.sqrt(rng.next())];
  const dir = turned(yaw, pitch, (W.kick[0] + out * Math.sin(turn)) * DEG, (W.kick[1] + out * Math.cos(turn)) * DEG);
  const step = recoilStep(kind, W.burst);
  [W.kick, W.burst, W.shot, W.shots] = [[W.kick[0] + step[0], W.kick[1] + step[1]], W.burst + 1, w.time, W.shots + 1];
  W.mags[W.slot] -= 1;
  const hit = physicsOf(w).raycast(from, dir, { maxDistance: kind.range, groups: SHOT_GROUPS, exclude: e.actor.body });
  const to: [number, number, number] = hit ? [hit.point.x, hit.point.y, hit.point.z] : [from[0] + dir[0] * kind.range, from[1] + dir[1] * kind.range, from[2] + dir[2] * kind.range]; // prettier-ignore
  const target = hit ? entityOfBody(w, hit.body) : -1;
  const struck = target >= 0 ? (w.get(target) as unknown as { thing?: { state: string }; health?: Health; sceneProp?: object }) : undefined; // prettier-ignore
  const counted = !!struck && (struck.thing?.state === 'up' || (!!struck.health && struck.health.hp > 0));
  if (struck?.sceneProp) strikeEntity(w, target, from, true, 'shot');
  else if (struck?.health) damage(w, { id: target, health: struck.health }, { amount: kind.damage, from, direction: dir, at: to, source: e.id }); // prettier-ignore
  if (counted) W.hits += 1;
  const normal = hit ? [hit.normal.x, hit.normal.y, hit.normal.z] : null;
  w.emit('gunshot', { id: e.id, weapon: kind.id, from, to, normal, body: hit?.body ?? -1, target, hit: counted });
}

/** Begins a reload of the weapon out (see the file comment). */
function reload(w: World, e: Player, kind: WeaponKind): void {
  const W = e.weapons;
  W.reload = w.time + (W.mags[W.slot] > 0 ? kind.reload.tactical : kind.reload.empty);
  w.emit('reload', { id: e.id, weapon: kind.id });
}

/** One step of `e`'s weapons (see the file comment). */
function stepOne(w: World, e: Player, intents: Intents): void {
  const W = e.weapons;
  const other = W.slot >= 0 ? (W.slot + 1) % W.slots.length : W.last;
  const want = pressed(intents, 'weapon1') ? 0 : pressed(intents, 'weapon2') ? 1 : pressed(intents, 'swap') ? other : -1; // prettier-ignore
  if (want >= 0 && want < W.slots.length && want !== W.slot) draw(w, e, want);
  else if (pressed(intents, 'holster')) {
    if (W.slot >= 0) holster(w, e);
    else draw(w, e, W.last);
  } else if (W.slot < 0 && pressed(intents, 'fire')) draw(w, e, W.last);
  if (W.slot < 0) return;
  const kind = getWeapon(W.slots[W.slot]);
  if (W.reload >= 0 && w.time >= W.reload - 1e-9) [W.mags[W.slot], W.reload] = [kind.magazine, -1];
  const up = held(intents, 'aim') && FIRING.has(e.motion?.mode ?? 'ground');
  W.aim = Math.max(0, Math.min(1, W.aim + (up ? 1 : -1) * (kind.sights > 0 ? w.dt / kind.sights : 1)));
  if (W.shot >= 0 && w.time - W.shot > kind.settle + 1e-9) {
    const fall = kind.recover > 0 ? Math.exp(-w.dt / kind.recover) : 0; // the burst over: its kick falls away
    const kick: [number, number] = [W.kick[0] * fall, W.kick[1] * fall];
    [W.burst, W.kick] = [0, Math.hypot(kick[0], kick[1]) < 1e-4 ? [0, 0] : kick];
  }
  if (pressed(intents, 'reload') && W.reload < 0 && W.mags[W.slot] < kind.magazine) reload(w, e, kind);
  const trigger = kind.auto ? held(intents, 'fire') : pressed(intents, 'fire');
  if (!trigger || W.reload >= 0 || w.time < W.ready - 1e-9 || !FIRING.has(e.motion?.mode ?? 'ground')) return;
  if (e.melee && (e.melee.move !== '' || (e.melee.began >= 0 && (w.tick - e.melee.began) * w.dt < MELEE.back - 1e-9))) return; // prettier-ignore
  if (W.mags[W.slot] <= 0) {
    if (pressed(intents, 'fire')) w.emit('dry', { id: e.id, weapon: kind.id });
    return reload(w, e, kind);
  }
  if (w.time < W.next - 1e-9) return;
  W.next = (kind.auto && w.time - W.next < w.dt ? W.next : w.time) + 1 / kind.rate; // a held trigger keeps the rate
  shoot(w, e, kind, intents);
  if (W.mags[W.slot] === 0) reload(w, e, kind); // the last round brings the reload on
}

/** The system `weapons`: each player's weapons, in id order (see the file comment). */
function stepWeapons(w: World, intents: Intents): void {
  for (const e of w.query('actor', 'weapons') as unknown as Player[]) {
    if (!e.actor.player) continue;
    stepOne(w, e, intents);
    if (e.motion) e.motion.holstered = e.weapons.slot < 0;
    if (e.animator) e.animator.weapon = e.weapons.slot >= 0 ? 'gun' : 'none';
  }
}
