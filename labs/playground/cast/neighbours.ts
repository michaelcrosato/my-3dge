/**
 * @file The neighbours (docs/PLAYGROUND.md §7.4; PLAN.md WP 13.21): four people about the block, each on a route of
 * stops kept on a schedule (`NEIGHBOURS`: the north sidewalk end to end, the porch and the front path, the garden
 * bench and the backyard, the bus stop's bench and the south sidewalk; engine/world/aiRoutes.ts `followRoute`),
 * strolling between them over the site's navigation round its props (a flow field a stop: ways.ts beside it). Each
 * knows the player by WP 10.4's awareness (`sense`: in sight within `NEIGHBOUR.sight` m, nothing
 * of the world between their eyes; a shot or a kick it hears) and reacts:
 * - it looks at him (its head along `intents.look`) while he is within `NEIGHBOUR.look` m and in sight, and for a
 *   moment at a noise it heard;
 * - it steps aside, to its right, when he stands in its way (`stepAside`);
 * - it flinches when he shoves into it (he comes within `NEIGHBOUR.shove` m, moving at it);
 * - it startles at a shot or a kick it hears (a flinch away from it, and a look);
 * - a hard blow (a kick or the uppercut, `PARTNER_BLOWS`) hands it off to its ragdoll (WP 10.2), and it gets up the
 *   way it lies; a punch or a shot flinches it. Its hit points come back at every blow (health.ts beside it).
 * Each reaction emits `neighbour` `{ id, what }` (`look`, `aside`, `shoved`, `startle`, `flinch`, `fall`), as do its
 * sitting down and rising (`sit`, `rise`: `action:sit`, a seat behind it, on the benches' stops). Each is
 * drawn as `body:neighbour<k>` (labs/playground/bodies/neighbours.ts: the player's slots varied by a seed of its own,
 * which the page registers); the sim names it by id only. `standNeighbours(w)` stands them and adds the systems
 * `ragdolls` and `neighbours` (phase `ai`, after the step's blows and shots: engine/sim/melee.ts, weapons.ts).
 *
 * Invariants: everything a neighbour is lives in its components (`neighbour`, `route`, `awareness`, `health`);
 * neighbours step in id order; no random stream.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // in the site's setup, after the player: standNeighbours(w);
 * NEIGHBOURS.map((n) => n.name); // ['walker', 'porch', 'gardener', 'commuter']
 * @see labs/playground/cast/neighbours.test.ts
 */
import { actOn, addRagdolls, AWARENESS_FIELDS, createCharacter, defineAction, defineComponent, followRoute, handOff, physicsOf, reactTo, ROUTE_FIELDS, sense, spawnActor, stepAside, Vector3, type Awareness, type Health, type MeleeState, type Noise, type RagdollState, type RouteState, type RouteStop, type WeaponsState, type World } from '../../../engine/sim-api'; // prettier-ignore
import { CAST_HP, castHealth } from './health';
import { PARTNER_BLOWS } from './partners';
import { wayTo } from './ways';

/** A neighbour: its name, its body's index (`body:neighbour<k>`) and its route. */
export interface Neighbour {
  readonly name: string;
  readonly body: number;
  readonly stops: readonly RouteStop[];
}

/** The north sidewalk's and the south's walking line (m, south), and their floor (m up). */
const [NORTH, SOUTH, KERB] = [84.75, 93.75, 0.15];

/** The neighbours and their rounds (see the file comment): stops in world metres, stays in seconds. */
export const NEIGHBOURS: readonly Neighbour[] = [
  {
    name: 'walker',
    body: 0,
    stops: [
      { at: [46.25, KERB, NORTH], stay: 3 },
      { at: [90.25, KERB, NORTH], stay: 3 },
    ],
  },
  { name: 'porch', body: 1, stops: [{ at: [52.25, 0, 61.75], stay: 12, facing: 0 }, { at: [52.25, KERB, 83.75], stay: 4 }] }, // prettier-ignore
  { name: 'gardener', body: 2, stops: [{ at: [56.5, 0, 41], stay: 14, doing: 'sit', facing: 0 }, { at: [61.75, 0, 49.25], stay: 4 }] }, // prettier-ignore
  { name: 'commuter', body: 3, stops: [{ at: [82.25, KERB, 93.75], stay: 16, doing: 'sit', facing: Math.PI }, { at: [94.25, KERB, SOUTH], stay: 3 }] }, // prettier-ignore
];

/** How they go about: a stroll (m/s), how far they see and look (m), how near a shove comes (m) and how fast (m/s),
 * how long a step aside, a flinch's rest and a look at a noise last (s), and the noises' carry (m). */
export const NEIGHBOUR = {
  stroll: 1.3,
  sight: 14,
  look: 6,
  shove: 0.85,
  shoveSpeed: 1,
  aside: 0.8,
  rest: 1,
  glance: 2,
  noise: { shot: 40, kick: 12 },
  /** How near a stop it settles (m), how fast it turns to a stop's way (rad/s), and how long it takes to rise (s). */
  settle: 0.08,
  turn: 3,
  rise: 0.6,
} as const;

/** Sitting on a seat behind the body: the pelvis back and down onto it, the feet planted ahead, until told to rise. */
const SEAT = { motion: { hop: -0.42, lunge: -0.3, lean: 0.12 }, effectors: { footL: [0.18, -0.13, 0], footR: [0.18, 0.13, 0] } }; // prettier-ignore
defineAction('action:sit', {
  desc: 'Sitting down on a bench behind the body (WP 13.21): its pelvis back and down onto the seat, its feet planted ahead, until told to rise (next), then up again.', // prettier-ignore
  beats: [
    { name: 'lower', seconds: 0.6, ...SEAT },
    { name: 'seated', seconds: 0.3, until: 'next', ...SEAT, motion: { ...SEAT.motion, lean: 0.04 } },
    { name: 'rise', seconds: NEIGHBOUR.rise },
  ],
  check: { signals: [{ at: 1.5, do: 'next' }], seconds: 2.4 }, // how the anim QA plays it: sat 1.5 s, then up
});

/** A neighbour's own state: its index, its step aside (until when, which way), its last flinch, whether it looks. */
export const NEIGHBOUR_FIELDS = {
  index: { type: 'integer', default: 0, minimum: 0, description: 'Its place in NEIGHBOURS.' },
  aside: { type: 'number', default: -1, unit: 's', description: 'Until when it steps aside (−1: it does not).' },
  ax: { type: 'number', default: 0, description: 'The way it steps aside, east.' },
  az: { type: 'number', default: 0, description: 'The way it steps aside, south.' },
  flinched: { type: 'number', default: -1, unit: 's', description: 'When it last flinched (−1: never).' },
  looking: { type: 'boolean', default: false, description: 'Whether it looks at the player now.' },
  seated: { type: 'boolean', default: false, description: 'Whether it sits now (action:sit).' },
  rising: {
    type: 'number',
    default: -1,
    unit: 's',
    description: 'Until when it rises from its seat (−1: it does not).',
  },
} as const;

defineComponent('neighbour', { description: 'One of the block’s neighbours (WP 13.21).', fields: NEIGHBOUR_FIELDS });
defineComponent('route', { description: 'An agent’s place on its route (WP 13.21).', fields: ROUTE_FIELDS });
defineComponent('awareness', { description: 'What an agent knows of the player (WP 10.4).', fields: AWARENESS_FIELDS }); // prettier-ignore

/** A neighbour as this module reads it. */
type Person = {
  id: number;
  neighbour: { index: number; aside: number; ax: number; az: number; flinched: number; looking: boolean; seated: boolean; rising: number }; // prettier-ignore
  route: RouteState;
  awareness: Awareness;
  health: Health;
  actor: { x: number; y: number; z: number; yaw: number; vx: number; vz: number; character: { speed: number }; intents: Record<string, unknown> }; // prettier-ignore
  ragdoll?: RagdollState;
};
/** The player as this module reads him: where he stands and moves, his swing and his guns. */
type Player = Person['actor'] & { id: number; melee?: MeleeState; weapons?: WeaponsState };
/** An actor's entity as the query gives it. */
type Actor = { id: number; actor: Person['actor'] & { player: boolean }; melee?: MeleeState; weapons?: WeaponsState };

const [eye, toward, along] = [new Vector3(), new Vector3(), new Vector3()];
const EYE = 1.6;

/** Whether nothing of the world stands between a neighbour's eyes and the player's. */
function inSight(w: World, n: Person['actor'], p: Player): boolean {
  eye.set(n.x, n.y + EYE, n.z);
  toward.set(p.x - n.x, p.y - n.y, p.z - n.z);
  const far = toward.length();
  if (far > NEIGHBOUR.sight) return false;
  const hit = physicsOf(w).raycast(eye, toward.normalize(), { maxDistance: far, groups: ['world'] });
  return !hit || hit.distance >= far - 0.3;
}

/** The noises the player made this step: a shot (as it fired) and a kick (as it landed). */
function noisesOf(w: World, p: Player): Noise[] {
  const out: Noise[] = [];
  if (p.weapons && Math.abs(p.weapons.shot - w.time) < w.dt / 2) out.push({ x: p.x, y: p.y + 1.4, z: p.z, loudness: NEIGHBOUR.noise.shot, source: p.id, kind: 'shot' }); // prettier-ignore
  if (p.melee?.hitAt === w.tick && p.melee.move === 'move:kick') out.push({ x: p.x, y: p.y + 0.5, z: p.z, loudness: NEIGHBOUR.noise.kick, source: p.id, kind: 'kick' }); // prettier-ignore
  return out;
}

/** The view along from (x, y, z) to `to`: [yaw, pitch], rad (the intents' `look`). */
const lookAt = (x: number, y: number, z: number, to: { x: number; y: number; z: number }): [number, number] => [Math.atan2(to.x - x, to.z - z), Math.atan2(to.y - y, Math.hypot(to.x - x, to.z - z))]; // prettier-ignore

/** Neighbour `n` stands up at once from its seat, if it sits (a blow, a fall). */
function unseat(w: World, n: Person): void {
  if (!n.neighbour.seated) return;
  actOn(w, n.id, (act) => act.stop());
  n.neighbour.seated = false;
}

/** A blow landed on neighbour `n` this step: it falls to a hard one, else flinches (see the file comment). */
function struck(w: World, n: Person, p: Player | undefined): void {
  n.health.hp = CAST_HP;
  unseat(w, n);
  const from = p ?? (w.get(n.health.hitBy) as unknown as Actor | undefined)?.actor;
  along.set(n.actor.x - (from?.x ?? n.actor.x), 0, n.actor.z - (from?.z ?? n.actor.z - 1));
  if (along.lengthSq() < 1e-12) along.set(0, 0, 1);
  along.normalize();
  const hard = p?.melee?.hitAt === w.tick && p.melee.struck === n.id ? PARTNER_BLOWS[p.melee.move] : undefined;
  if (hard) handOff(w, n.id, { push: [along.x * hard.along, hard.up, along.z * hard.along] });
  else reactTo(w, n.id, (r) => r.hit(along, n.actor.yaw, 0.6));
  w.emit('neighbour', { id: n.id, what: hard ? 'fall' : 'flinch' });
}

/** The system `neighbours`: each one's step (see the file comment). */
function stepNeighbours(w: World): void {
  const player = (w.query('actor') as unknown as Actor[]).find((e) => e.actor.player);
  const p: Player | undefined = player && { ...player.actor, id: player.id, melee: player.melee, weapons: player.weapons }; // prettier-ignore
  const noises = p ? noisesOf(w, p) : [];
  for (const n of w.query('neighbour', 'route', 'awareness', 'health', 'actor') as unknown as Person[]) {
    const { actor: a, neighbour: me } = n;
    if (n.health.hitAt === w.tick) struck(w, n, p);
    if (n.ragdoll && n.ragdoll.rise < 0) {
      unseat(w, n);
      a.intents = {};
      continue;
    }
    const sees = p !== undefined && inSight(w, a, p);
    const heard = sense(n.awareness, { time: w.time, ears: { x: a.x, y: a.y + EYE, z: a.z }, sees, target: p, noises });
    if (heard.state === 'heard' && n.awareness.heard === w.time) {
      along.set(a.x - n.awareness.x, 0, a.z - n.awareness.z);
      if (along.lengthSq() > 1e-12) reactTo(w, n.id, (r) => r.hit(along.normalize(), a.yaw, 0.4));
      w.emit('neighbour', { id: n.id, what: 'startle' });
    }
    const near = p ? Math.hypot(p.x - a.x, p.z - a.z) : Infinity;
    const closing = p && near > 1e-6 ? -((p.x - a.x) * (p.vx - a.vx) + (p.z - a.z) * (p.vz - a.vz)) / near : 0;
    if (p && near < NEIGHBOUR.shove && closing > NEIGHBOUR.shoveSpeed && w.time - me.flinched >= NEIGHBOUR.rest) {
      along.set(a.x - p.x, 0, a.z - p.z).normalize();
      reactTo(w, n.id, (r) => r.hit(along, a.yaw, 0.5));
      me.flinched = w.time;
      w.emit('neighbour', { id: n.id, what: 'shoved' });
    }
    const looking = sees && near < NEIGHBOUR.look;
    if (looking && !me.looking) w.emit('neighbour', { id: n.id, what: 'look' });
    me.looking = looking;
    const glance = n.awareness.heard >= 0 && w.time - n.awareness.heard < NEIGHBOUR.glance;
    const look = looking && p ? lookAt(a.x, a.y + EYE, a.z, { x: p.x, y: p.y + EYE, z: p.z }) : glance ? lookAt(a.x, a.y + EYE, a.z, n.awareness) : undefined; // prettier-ignore
    a.intents = { ...walk(w, n, p), ...(look ? { look } : {}) };
  }
}

/** Where neighbour `n` walks this step (see the file comment): its intents' `move`, if any; it turns, sits and rises. */
function walk(w: World, n: Person, p: Player | undefined): { move?: [number, number] } {
  const { actor: a, neighbour: me } = n;
  const stroll = NEIGHBOUR.stroll / a.character.speed;
  if (w.time < me.rising) return {};
  if (w.time < me.aside) return { move: [me.ax * stroll, me.az * stroll] };
  const leg = followRoute(NEIGHBOURS[me.index].stops, n.route, a, w.time, 0.6);
  if (!leg.staying && me.seated) {
    actOn(w, n.id, (act) => act.next()); // its stay is over: it rises, then goes
    [me.seated, me.rising] = [false, w.time + NEIGHBOUR.rise];
    w.emit('neighbour', { id: n.id, what: 'rise' });
    return {};
  }
  const [dx, dz] = [leg.stop.at[0] - a.x, leg.stop.at[2] - a.z];
  const off = Math.hypot(dx, dz);
  if (leg.staying) {
    if (me.seated) return {};
    if (off > NEIGHBOUR.settle) return { move: [(dx / off) * stroll * Math.min(1, off / 0.3), (dz / off) * stroll * Math.min(1, off / 0.3)] }; // prettier-ignore
    const facing = leg.stop.facing;
    const turn = facing === undefined ? 0 : Math.atan2(Math.sin(facing - a.yaw), Math.cos(facing - a.yaw));
    a.yaw += Math.sign(turn) * Math.min(Math.abs(turn), NEIGHBOUR.turn * w.dt); // turns in place to the stop's way
    if (leg.stop.doing === 'sit' && Math.abs(turn) < 0.05) {
      actOn(w, n.id, (act) => act.play('sit'));
      me.seated = true;
      w.emit('neighbour', { id: n.id, what: 'sit' });
    }
    return {};
  }
  const { nav, field } = wayTo(w, leg.stop, leg.stop.at);
  const dir = nav.direction(field, a.x, a.y, a.z) ?? (off > 1e-6 ? { x: dx / off, z: dz / off } : null);
  if (!dir) return {};
  const aside = p ? stepAside(a, Math.atan2(dir.x, dir.z), p) : null;
  if (!aside) return { move: [dir.x * stroll, dir.z * stroll] };
  [me.aside, me.ax, me.az] = [w.time + NEIGHBOUR.aside, aside[0], aside[1]];
  w.emit('neighbour', { id: n.id, what: 'aside' });
  return { move: [aside[0] * stroll, aside[1] * stroll] };
}

/** Stands the neighbours at their routes' first stops and adds their systems (see the file comment); their ids. */
export function standNeighbours<C extends object>(world: World<C>): number[] {
  const w = world as unknown as World;
  const ids = NEIGHBOURS.map(({ body, stops }, index) => {
    const components = { neighbour: { index }, route: {}, awareness: {}, health: castHealth() };
    const [x, y, z] = stops[0].at;
    return spawnActor(w, { at: [x, y, z], yaw: stops[0].facing ?? 0, character: createCharacter(), player: false, body: `body:neighbour${body}`, anim: { build: 'build:adult' }, components }); // prettier-ignore
  });
  addRagdolls(w);
  if (!w.systems.has('neighbours')) w.systems.add('neighbours', stepNeighbours, { phase: 'ai' });
  return ids;
}
