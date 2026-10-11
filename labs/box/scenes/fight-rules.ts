/**
 * @file The fight's rules, Box 5 (PLAN.md §9.0, WP 6.7): what labs/box/scenes/fight.ts and its systems
 * (fight-hero.ts, fight-foes.ts) share. Its components, its setting, its events, and the two ways a blow lands:
 * `strikeFoe` (the hero's hit or bolt on a member of the crowd) and `hurtHero` (a foe's on him), each through the
 * engine's `damage` (engine/sim/damage.ts: hit points, the push as momentum, the throw, the corpse group, the
 * hit-stop and the event `damage` the page draws its damage numbers from).
 *
 * - **Components**: `fightHealth` (`HEALTH_FIELDS`) on the hero and every foe; `fightHero` (his combo and thrust as
 *   their saved states, and his counters in ticks); `fightFoe` (where a foe is in its attack and its timers);
 *   `fightTelegraph` (a foe's telegraph where it stands, a `TelegraphPlace` as plain data: none while `telegraph` is
 *   empty); `fightShot` (a bolt in flight, `PROJECTILE_FIELDS` and the hit points it takes); `fightTokens`
 *   (`ATTACK_TOKENS_FIELDS`, on the hero: who may attack him now).
 * - **Events**, for the page's effects (engine/gfx/fx: emitters answer them by type): `hit` where a blow lands,
 *   `slain` where a body falls, `shot` where a bolt leaves, `slam` where a pounce lands, each with its `position`
 *   and `size`. They change nothing in the sim.
 * - **The setting** `box.fight.god` (true, read when the scene starts, as the prototype's proof ran): foes' blows
 *   still flinch and push the hero, but take no hit points. Off, they do; at none he falls (`slain`) and is up again
 *   at once with all of them: the box has no end to its fight.
 *
 * A blow on a foe breaks its attack off (`breakAttack`: its token back, its telegraph gone) and stuns it for
 * `STUN` s; one that kills it lets it fall with the kill's throw (`HERO_FIGHT.kill`), a body the crowd walks through
 * that the crowd's step removes later.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @see labs/box/scenes/fight.test.ts
 */
import {
  ATTACK_TOKENS_FIELDS,
  Attack,
  Combo,
  HEALTH_FIELDS,
  PROJECTILE_FIELDS,
  SpatialHash,
  damage,
  defineComponent,
  defineSettings,
  releaseToken,
  type ActorComponent,
  type AnimatorComponent,
  type AttackState,
  type AttackTokens,
  type ComboState,
  type DamageEvents,
  type Health,
  type HurtSet,
  type Projectile,
  type World,
} from '../../../engine/sim-api';
import { HERO, HERO_FIGHT, type HeroHit } from '../cast/hero';
import type { CrowdComponents } from './crowd-1000';

/** The fight's setting: whether the hero's hit points hold. */
export const FIGHT_SETTINGS = defineSettings({
  'box.fight.god': {
    type: 'boolean',
    default: true,
    when: 'scene',
    description: 'Foes’ blows flinch and push the hero but take no hit points (off: they do, and he rallies at none).',
  },
});

/** How long a blow stuns a foe (s): it steers and attacks again after. The prototype's. */
export const STUN = 0.22;

/** The hero's combo, as `HERO_FIGHT` says (an idle one; its state is `fightHero.combo`). */
export const heroCombo = () => new Combo([...HERO_FIGHT.combo], { window: HERO_FIGHT.window });
/** The hero's thrust out of a dash (an idle one; its state is `fightHero.thrust`). */
export const heroThrust = () => new Attack(HERO_FIGHT.thrust);
const IDLE_COMBO: ComboState = heroCombo().save();
const IDLE_ATTACK: AttackState = heroThrust().save();

/** The hero's fight: his combo's and thrust's saved states, and his counters (ticks). */
export interface FightHero {
  combo: ComboState;
  thrust: AttackState;
  bolt: number;
  cast: number;
  flinch: number;
  safe: number;
}

/** Where a foe is in its attack. */
export type FoePhase = 'idle' | 'wind' | 'strike' | 'pounce';

/** A foe's fight: where it is in its attack, its move and swing, and its timers (s). */
export interface FightFoe {
  phase: FoePhase;
  timer: number;
  move: number;
  attack: AttackState;
  cool: number;
  stun: number;
}

/** A foe's telegraph where it stands: a `TelegraphPlace` as plain data (none while `telegraph` is empty). */
export interface FightTelegraph {
  telegraph: string;
  position: [number, number, number];
  yaw: number;
  u: number;
  size: number;
}

/** A bolt in flight: a projectile, and the hit points it takes. */
export type FightShot = Projectile & { damage: number };

/** A burst for the page's effects: where, and how big. */
export interface FightBurst {
  position: [number, number, number];
  size: number;
}

/** The fight's events. */
export type FightEvents = DamageEvents & { hit: FightBurst; slain: FightBurst; shot: FightBurst; slam: FightBurst };

/** The fight's components: the crowd's, the hero's actor, and its own. */
export type FightComponents = CrowdComponents & {
  actor: ActorComponent;
  animator: AnimatorComponent;
  fightHealth: Health;
  fightHero: FightHero;
  fightFoe: FightFoe;
  fightTelegraph: FightTelegraph;
  fightShot: FightShot;
  fightTokens: AttackTokens;
};

/** The fight's world. */
export type FightWorld = World<FightComponents, FightEvents>;

const ticks = (description: string) => ({ type: 'integer', default: 0, minimum: 0, description }) as const;
const seconds = (description: string) => ({ type: 'number', default: 0, unit: 's', description }) as const;

/** The component `fightHealth`: a fighter's hit points (see the file comment). */
export const FIGHT_HEALTH = defineComponent('fightHealth', {
  description: 'A fighter’s hit points in the box’s fight: the hero’s and every foe’s.',
  fields: HEALTH_FIELDS,
});
/** The component `fightHero`: the hero's combo, thrust and counters. */
export const FIGHT_HERO = defineComponent('fightHero', {
  description: 'The hero’s fight in the box: his combo and thrust (saved states) and his counters.',
  fields: {
    combo: { type: 'object', default: IDLE_COMBO, description: 'His combo (Combo.save()).' },
    thrust: { type: 'object', default: IDLE_ATTACK, description: 'His thrust out of a dash (Attack.save()).' },
    bolt: ticks('Ticks until he can fire a bolt again.'),
    cast: ticks('Ticks left of his cast, hands thrust forward.'),
    flinch: ticks('Ticks left of his flinch after a blow.'),
    safe: ticks('Ticks left during which no blow lands on him.'),
  },
});
/** The component `fightFoe`: where a foe is in its attack, and its timers. */
export const FIGHT_FOE = defineComponent('fightFoe', {
  description: 'A foe’s fight in the box: where it is in its attack, its move and swing, and its timers.',
  fields: {
    phase: {
      type: 'string',
      enum: ['idle', 'wind', 'strike', 'pounce'],
      default: 'idle',
      description: 'idle, wind (its telegraph filling), strike (a walker’s swing on), pounce (a slime’s leap).',
    },
    timer: seconds('A slime’s squat or a wisp’s charge: the seconds left.'),
    move: { type: 'integer', default: 0, minimum: 0, description: 'A walker’s move, by its place in its list.' },
    attack: { type: 'object', default: IDLE_ATTACK, description: 'A walker’s swing (Attack.save()).' },
    cool: seconds('Seconds before it may attack again (a wisp’s: before it charges).'),
    stun: seconds('Seconds of stun left after a blow.'),
  },
});
/** The component `fightTelegraph`: a foe's telegraph where it stands. */
export const FIGHT_TELEGRAPH = defineComponent('fightTelegraph', {
  description: 'A foe’s telegraph where it stands (a TelegraphPlace): none while telegraph is empty.',
  fields: {
    telegraph: { type: 'string', default: '', description: 'The telegraph’s id; empty: none.' },
    position: {
      type: 'array',
      items: { type: 'number' },
      default: [0, 0, 0],
      description: 'Its origin on the floor (m).',
    },
    yaw: { type: 'number', default: 0, unit: 'rad', description: 'Its facing: forward is (sin yaw, 0, cos yaw).' },
    u: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'How far its wind-up has run, 0 to 1.' },
    size: { type: 'number', default: 1, minimum: 0, description: 'Scales its lengths.' },
  },
});
/** The component `fightShot`: a bolt in flight. */
export const FIGHT_SHOT = defineComponent('fightShot', {
  description: 'A bolt in flight in the box’s fight: a projectile, and the hit points it takes.',
  fields: { ...PROJECTILE_FIELDS, damage: { type: 'number', default: 0, description: 'The hit points it takes.' } },
});
/** The component `fightTokens`: the hero's attack tokens. */
export const FIGHT_TOKENS = defineComponent('fightTokens', {
  description: 'Who may attack the hero now (engine/world/ai.ts attack tokens), on the hero.',
  fields: ATTACK_TOKENS_FIELDS,
});

/** The hero: his id and components; undefined before setup. */
export function heroOf(w: FightWorld) {
  return w.query('fightHero', 'actor', 'animator', 'fightHealth', 'fightTokens')[0];
}

const foeHash = new SpatialHash({ cell: 2 });
const heroHash = new SpatialHash({ cell: 2 });

/** The living foes as hurt capsules, through a spatial hash of their feet, built now. */
export function foeSet(w: FightWorld): HurtSet {
  foeHash.clear();
  const byId = new Map<number, FightComponents['crowdMember']>();
  for (const { id, crowdMember: a } of w.query('crowdMember', 'fightFoe')) {
    if (a.state !== 'alive') continue;
    foeHash.add(id, a.x, a.z);
    byId.set(id, a);
  }
  return { hash: foeHash, hurt: (id) => byId.get(id), margin: 0.5 };
}

/** The hero as a hurt capsule (his controller's), built now. */
export function heroSet(w: FightWorld): HurtSet {
  heroHash.clear();
  const hero = heroOf(w);
  if (!hero) return { hash: heroHash, hurt: () => undefined };
  const { x, y, z } = hero.actor;
  heroHash.add(hero.id, x, z);
  const { radius, height } = HERO.capsule;
  return { hash: heroHash, hurt: (id) => (id === hero.id ? { x, y, z, radius, height } : undefined) };
}

/** Ends a foe's attack: its token back, its telegraph gone. */
export function breakAttack(w: FightWorld, id: number): void {
  const e = w.get(id);
  if (!e?.fightFoe) return;
  e.fightFoe.phase = 'idle';
  if (e.fightTelegraph) e.fightTelegraph.telegraph = '';
  const hero = heroOf(w);
  if (hero) releaseToken(hero.fightTokens, id);
}

/**
 * The hero's blow (`hit`, from his feet `from`) on the foe `id`: its hit points, push, throw and hit-stop through
 * `damage`, its attack broken off, a stun, and the events `hit` (and `slain`). Returns whether it landed.
 */
export function strikeFoe(w: FightWorld, id: number, hit: Omit<HeroHit, 'shape' | 'push'>, from: number[]): boolean {
  const e = w.get(id);
  if (!e?.crowdMember || !e.fightHealth || !e.fightFoe) return false;
  const { kill, launch, stop } = HERO_FIGHT;
  const event = damage(
    w,
    { id, health: e.fightHealth, agent: e.crowdMember },
    {
      amount: hit.damage,
      from: [from[0], from[1], from[2]],
      source: heroOf(w)?.id ?? -1,
      knockback: hit.knockback,
      launch: hit.big ? launch : 0,
      kill: { launch: hit.big ? kill.big : kill.small, carry: kill.carry },
      stop: hit.big ? stop.big : stop.small,
    },
  );
  if (!event) return false;
  breakAttack(w, id);
  e.fightFoe.stun = STUN;
  w.emit('hit', { position: [...event.at], size: hit.big ? 1.3 : 1 });
  const a = e.crowdMember;
  if (event.killed) w.emit('slain', { position: [a.x, a.y, a.z], size: 1 });
  return true;
}

/**
 * A foe's blow (`amount` hit points, from `from`) on the hero: unless he is safe, he flinches and is pushed away, the
 * hit lands through `damage` (no hit points in god mode), his combo is broken off when it takes any, and the event
 * `hit` fires. Returns whether it landed.
 */
export function hurtHero(w: FightWorld, amount: number, from: number[], source: number): boolean {
  const hero = heroOf(w);
  if (!hero || hero.fightHero.safe > 0) return false;
  const { fightHero: f, actor, fightHealth: health } = hero;
  const { flinch, knockback, safe, stop } = HERO_FIGHT.hurt;
  const god = w.settings.get<boolean>('box.fight.god');
  [f.flinch, f.safe] = [Math.round(flinch / w.dt), Math.round(safe / w.dt)];
  const event = damage(
    w,
    { id: hero.id, health },
    { amount: god ? 0 : amount, from: [from[0], from[1], from[2]], source, stop },
  );
  if (!event) return false;
  [actor.vx, actor.vz] = [actor.vx + event.dir[0] * knockback, actor.vz + event.dir[2] * knockback];
  const centre: [number, number, number] = [actor.x, actor.y + HERO.capsule.radius + HERO.capsule.height / 2, actor.z];
  w.emit('hit', { position: centre, size: 0.8 });
  if (god) return true;
  f.combo = heroCombo().save();
  f.thrust = heroThrust().save();
  if (event.killed) {
    w.emit('slain', { position: [actor.x, actor.y, actor.z], size: 1 });
    health.hp = HERO_FIGHT.health;
  }
  return true;
}
