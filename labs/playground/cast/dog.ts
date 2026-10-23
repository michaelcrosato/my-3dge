/**
 * @file The dog (docs/PLAYGROUND.md §7.4; PLAN.md WP 13.21): Biscuit, on the quadruped rig (engine/anim/quadruped.ts,
 * WP 10.1's planted gait), drawn as a crowd body (the rig `quadruped`), with an actor's capsule of its own so it meets
 * the world and its props, climbs a kerb and goes where the player goes (actors pass through each other). `standDog(w,
 * at, yaw)` stands it beside the player's spawn facing him, its ball (`prop:playground-ball`) on the ground before its
 * paws (off his way), and adds its systems. What it does (`dog.mode`):
 * - **follow**: it trots after the player when he is farther than `DOG.near` m and runs when farther than `DOG.far`
 *   (shardfall's town dog); near him it stands and looks at him, and once he has stood still `DOG.sitAfter` s it
 *   **sits**, facing him and wagging, until he moves off;
 * - **chase**: thrown (he held the ball the step before and holds it no more, and it flies), the ball is chased, the
 *   dog slowing as it comes; lying under its mouth, within `DOG.reach` m across and `DOG.low` m up, it is picked up
 *   and **carried** back to him, pulled to its mouth each step as a player's carry is (engine/sim/interact.ts), the
 *   dog slowing as it comes, and let fall from its mouth `DOG.drop` m from him;
 * - **wait**: a dog told to go that has not moved `DOG.gain` m in `DOG.stall` s (a door opened onto it, the ball on a
 *   roof) has the ways made again round the props as they stand (`replanWays`) and backs out `DOG.backOff` s the way
 *   with the most room; held again (a door's leaf swung into it, which its capsule cannot walk out of), it is set down
 *   on the clear point of its tile or of one beside it on its own floor, and waits `DOG.wait` s, then follows again. A
 *   chase gives up after `DOG.chase` s, and his taking the ball ends one.
 * It goes over the site's navigation (ways.ts beside it) when its goal is more than `DOG.straight` m off, straight
 * when nearer; it steps aside when he stands in its way elsewhere (`stepAside`), and out of his way when he walks at
 * it. Each change emits `dog` `{ id, what }` (`follow`, `sit`, `chase`, `fetch`, `drop`, `wait`).
 *
 * Invariants: everything the dog is lives in its components (`dog`, `crowdBody`, its actor's); it steps in the phases
 * `ai` (what it does, its actor's intents) and `readback` (its rig, from where its capsule moved; the ball it
 * carries); dogs step in id order; no random stream.
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/arpg/scene.rs:772-814` (`npc_inputs`: the dog trots after the
 * hero beyond 2.4 m and runs beyond 7 m) and `:756-762` (it faces its way, and the hero when it stands); sitting,
 * fetching and waiting are new.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // in the site's setup, after the neighbours: standDog(w, areaStart(area), SITE_AREAS[area].yaw);
 * DOG.near; // 2.2: farther, it follows
 * @see labs/playground/cast/dog.test.ts
 */
import { ASIDE, createCharacter, defineComponent, physicsOf, placeActor, Quadruped, spawnActor, spawnProp, stepAside, stepCrowdBody, Vector3, type CrowdBody, type QuadrupedState, type World } from '../../../engine/sim-api'; // prettier-ignore
import { plainWays, replanWays, waysOf, wayTo } from './ways';

/** How the dog goes about (see the file comment): speeds, distances (m) and times (s). */
export const DOG = {
  speed: 6, // its run, m/s
  trot: 0.5, // the share of its run it trots at
  near: 2.2,
  far: 7,
  sitAfter: 1,
  stand: 0.3, // m/s: slower, the player stands
  beside: [1.2, 0.6], // where it stands at first: to the player's left and ahead
  ball: 0.45, // m before its middle where its ball lies at first: before its paws, toward him and off his way ahead
  reach: 0.3,
  low: 0.3,
  flies: 2, // m/s: a ball let go faster than this was thrown
  arrive: 0.45, // how near the ball its body slows to a stop (its mouth over it), and over how far it slows
  slowing: 1.2,
  drop: 1.4,
  stall: 3,
  gain: 0.3,
  backOff: 0.8, // s it backs out the freest way, held the first time
  wait: 4,
  chase: 12,
  straight: 3,
  pull: 12, // m/s: the fastest it pulls the ball to its mouth (a player's carry's)
  wag: { follow: 0.35, near: 0.7, sit: 1, chase: 0.9, carry: 0.6, wait: 0.2 },
} as const;

/** What the dog does (see the file comment). */
export const DOG_MODES = ['follow', 'sit', 'chase', 'carry', 'wait'] as const;

/** The dog's own state (the component `dog`). */
export const DOG_FIELDS = {
  mode: { type: 'string', enum: DOG_MODES, default: 'follow', description: 'What it does now.' },
  ball: { type: 'integer', default: -1, minimum: -1, description: 'Its ball, an entity; −1: none.' },
  since: { type: 'number', default: 0, unit: 's', description: 'When it began what it does.' },
  still: { type: 'number', default: -1, unit: 's', description: 'Since when the player has stood near it (−1: not).' }, // prettier-ignore
  held: { type: 'boolean', default: false, description: 'Whether the player held its ball the step before.' },
  sx: { type: 'number', default: 0, unit: 'm', description: 'Where it stood when it last moved on, east.' },
  sz: { type: 'number', default: 0, unit: 'm', description: 'Where it stood when it last moved on, south.' },
  moved: { type: 'number', default: 0, unit: 's', description: 'When it last moved on `DOG.gain` m, going.' },
  stalls: { type: 'integer', default: 0, minimum: 0, description: 'How often it has been held since it moved on.' },
  aside: { type: 'number', default: -1, unit: 's', description: 'Until when it steps aside (−1: it does not).' },
  ax: { type: 'number', default: 0, description: 'The way it steps aside, east.' },
  az: { type: 'number', default: 0, description: 'The way it steps aside, south.' },
} as const;
defineComponent('dog', { description: 'The dog: what it does, and its ball (WP 13.21).', fields: DOG_FIELDS });

/** The dog's capsule: a small body, its run `DOG.speed`, speeding up gently enough for its paws to keep up. */
const CHARACTER = { capsule: { radius: 0.2, height: 0.1 }, speed: DOG.speed, acceleration: 20, deceleration: 20, skid: 40 }; // prettier-ignore

type Mode = (typeof DOG_MODES)[number];
type Place = { x: number; y: number; z: number };
type DogState = { mode: Mode; ball: number; since: number; still: number; held: boolean; sx: number; sz: number; moved: number; stalls: number; aside: number; ax: number; az: number }; // prettier-ignore
type Dog = { id: number; dog: DogState; actor: Place & { yaw: number; vx: number; vz: number; grounded: boolean; body: number; intents: Record<string, unknown> }; crowdBody: CrowdBody }; // prettier-ignore
type Player = { id: number; actor: Place & { yaw: number; vx: number; vz: number; player: boolean }; interactor?: { holding: number } }; // prettier-ignore
type Ball = Place & { body: number };

const RIG = new Quadruped();
const [mouth, seen, way, spot] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

/** The player, if the world has one. */
const playerOf = (w: World) => (w.query('actor') as unknown as Player[]).find((e) => e.actor.player);
/** The dog's ball, if it is still a prop. */
const ballOf = (w: World, dog: DogState) => (w.get(dog.ball)?.sceneProp as unknown as Ball | undefined) ?? undefined;

/** Dog `d` begins `mode` now, emitting `what` (the mode by default). */
function begin(w: World, d: Dog, mode: Mode, what: string = mode): void {
  const me = d.dog;
  [me.mode, me.since, me.still, me.moved, me.sx, me.sz, me.stalls] = [
    mode,
    w.time,
    -1,
    w.time,
    d.actor.x,
    d.actor.z,
    0,
  ];
  w.emit('dog', { id: d.id, what });
}

/** Where dog `d`'s mouth is now (its rig as the last step left it), into `mouth`. */
function mouthOf(d: Dog): Vector3 {
  RIG.state = d.crowdBody.state as unknown as QuadrupedState;
  RIG.position.set(d.crowdBody.x, d.crowdBody.y, d.crowdBody.z);
  return mouth.copy(RIG.pose().mouth);
}

/** The move (a share of its run) that takes dog `d` toward `goal` at `share`, or none when it has to wait. */
function toward(w: World, d: Dog, goal: Place, share: number, p: Player['actor']): [number, number] | undefined {
  const { actor: a, dog: me } = d;
  if (Math.hypot(a.x - me.sx, a.z - me.sz) > DOG.gain) [me.sx, me.sz, me.moved, me.stalls] = [a.x, a.z, w.time, 0];
  else if (w.time - me.moved > DOG.stall && me.stalls > 0) {
    setDown(w, d); // held fast (a door's leaf swung into it): set down clear of it, then it waits
    return void begin(w, d, 'wait');
  } else if (w.time - me.moved > DOG.stall) {
    replanWays(w); // held by what its way does not know: the ways round the props as they stand, and out
    const [x, z] = freest(w, a);
    [me.aside, me.ax, me.az, me.moved, me.stalls] = [w.time + DOG.backOff, x, z, w.time, 1];
  }
  if (w.time < me.aside) return [me.ax * share, me.az * share];
  const off = Math.hypot(goal.x - a.x, goal.z - a.z);
  if (off < 1e-6) return undefined;
  way.set((goal.x - a.x) / off, 0, (goal.z - a.z) / off);
  if (off > DOG.straight) {
    const { nav, field } = wayTo(w, `dog:${d.id}:${me.mode}`, [goal.x, goal.y, goal.z]);
    const down = nav.direction(field, a.x, a.y, a.z);
    if (down) way.set(down.x, 0, down.z).normalize();
  }
  const aside = goal === p ? null : stepAside(a, Math.atan2(way.x, way.z), p); // he is in its way, not its goal
  if (aside) [me.aside, me.ax, me.az] = [w.time + 0.6, aside[0], aside[1]];
  return aside ? [aside[0] * share, aside[1] * share] : [way.x * share, way.z * share];
}

/**
 * Sets dog `d` down on the clear point of its tile or of one beside it on its own floor (the first within 1.5 m where
 * its capsule stands clear of the world and the props: the ways know neither a door's leaf nor what a test builds).
 */
function setDown(w: World, d: Dog): void {
  const [nav, a, { radius, height }] = [waysOf(w), d.actor, CHARACTER.capsule];
  const [shape, groups] = [{ type: 'capsule', radius, height } as const, ['world', 'prop'] as const];
  for (let k = 0; k <= 8; k++) {
    const [angle, out] = [(k * Math.PI) / 4, k === 0 ? 0 : 0.6];
    const node = nav.nodeAt(a.x + Math.sin(angle) * out, a.y, a.z + Math.cos(angle) * out);
    const clear = node >= 0 ? nav.clearAt(node, spot) : null;
    if (!clear || Math.abs(clear.y - a.y) > 0.3 || Math.hypot(clear.x - a.x, clear.z - a.z) > 1.5) continue;
    const centre = [clear.x, clear.y + radius + height / 2 + 0.03, clear.z] as const; // its feet 3 cm up
    if (physicsOf(w).overlap(shape, centre, { groups, exclude: a.body }).length) continue;
    return void placeActor(w, d.id, [clear.x, clear.y, clear.z]);
  }
}

/** The way from `a` across the ground with the most room before the world or a prop: of eight, the first of a tie. */
function freest(w: World, a: Place): [number, number] {
  let [best, room] = [0, -1];
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    const hit = physicsOf(w).raycast([a.x, a.y + 0.3, a.z], [Math.sin(angle), 0, Math.cos(angle)], { maxDistance: 1, groups: ['world', 'prop'] }); // prettier-ignore
    if ((hit?.distance ?? 1) > room) [best, room] = [angle, hit?.distance ?? 1];
  }
  return [Math.sin(best), Math.cos(best)];
}

/** Across the player's way, to the side dog `a` is on, when he walks at it (it lies within `ASIDE` of his way); else null. */ // prettier-ignore
function outOfHisWay(a: Place, p: Player['actor']): [number, number] | null {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < DOG.stand) return null;
  const [fx, fz, dx, dz] = [p.vx / speed, p.vz / speed, a.x - p.x, a.z - p.z];
  const [ahead, across] = [dx * fx + dz * fz, dx * fz - dz * fx];
  if (ahead < 0 || ahead > ASIDE.reach + 0.3 * speed || Math.abs(across) > ASIDE.width) return null;
  const side = across >= 0 ? 1 : -1;
  return [fz * side, -fx * side];
}

/** The system `dog`: what each dog does this step, and its actor's intents (see the file comment). */
function stepDogs(w: World): void {
  const player = playerOf(w);
  for (const d of w.query('dog', 'actor', 'crowdBody') as unknown as Dog[]) {
    const { dog: me, actor: a } = d;
    const ball = ballOf(w, me);
    if (!player) {
      a.intents = {};
      continue;
    }
    const p = player.actor;
    const holding = ball !== undefined && player.interactor?.holding === me.ball;
    const flying = ball !== undefined && physicsOf(w).readBody(ball.body).velocity.length() > DOG.flies;
    if (me.held && !holding && flying) begin(w, d, 'chase');
    me.held = holding;
    if (holding && (me.mode === 'chase' || me.mode === 'carry')) begin(w, d, 'follow');
    const near = Math.hypot(p.x - a.x, p.z - a.z);
    const moving = Math.hypot(p.vx, p.vz) > DOG.stand;
    let move: [number, number] | undefined;
    if (me.mode === 'chase' && (!ball || w.time - me.since > DOG.chase)) begin(w, d, 'follow');
    else if (me.mode === 'chase') {
      const m = mouthOf(d);
      const off = Math.hypot(ball!.x - a.x, ball!.z - a.z);
      if (Math.hypot(ball!.x - m.x, ball!.z - m.z) < DOG.reach && ball!.y - a.y < DOG.low)
        begin(w, d, 'carry', 'fetch');
      else move = toward(w, d, ball!, Math.min(1, Math.max(0.15, (off - DOG.arrive) / DOG.slowing)), p);
    } else if (me.mode === 'carry' && (!ball || near < DOG.drop)) {
      if (ball) physicsOf(w).setBody(ball.body, { velocity: [0, 0, 0], angularVelocity: [0, 0, 0] }); // let fall
      begin(w, d, 'follow', ball ? 'drop' : 'follow');
    } else if (me.mode === 'carry')
      move = toward(w, d, p, near > DOG.far ? 1 : Math.min(DOG.trot, Math.max(0.15, (near - DOG.drop) / DOG.slowing)), p); // prettier-ignore
    else if (me.mode === 'wait' && w.time - me.since > DOG.wait) begin(w, d, 'follow');
    else if (me.mode === 'sit' && (moving || near > DOG.near + 0.5)) begin(w, d, 'follow');
    else if (me.mode === 'follow' && near > DOG.near) {
      me.still = -1;
      move = toward(w, d, p, near > DOG.far ? 1 : DOG.trot, p);
    } else if (me.mode === 'follow') {
      [me.moved, me.sx, me.sz] = [w.time, a.x, a.z]; // standing by him: not stuck
      if (moving) me.still = -1;
      else if (me.still < 0) me.still = w.time;
      else if (w.time - me.still >= DOG.sitAfter) begin(w, d, 'sit');
    }
    const clear = me.mode === 'follow' || me.mode === 'sit' ? outOfHisWay(a, p) : null;
    if (clear && me.mode === 'sit') begin(w, d, 'follow');
    a.intents = clear ? { move: [clear[0] * DOG.trot, clear[1] * DOG.trot] } : move ? { move } : {};
  }
}

/** The system `dog.body`: each dog's rig from where its capsule moved, and the ball it carries pulled to its mouth. */
function poseDogs(w: World): void {
  const player = playerOf(w);
  for (const d of w.query('dog', 'actor', 'crowdBody') as unknown as Dog[]) {
    const { dog: me, actor: a } = d;
    const ball = ballOf(w, me);
    const p = player?.actor;
    const near = p ? Math.hypot(p.x - a.x, p.z - a.z) : Infinity;
    const facing = p && (me.mode === 'sit' || (me.mode === 'follow' && near <= DOG.near)) ? Math.atan2(p.x - a.x, p.z - a.z) : undefined; // prettier-ignore
    const look = me.mode === 'chase' && ball ? seen.set(ball.x, ball.y, ball.z) : p && near < 10 ? seen.set(p.x, p.y + 1.5, p.z) : null; // prettier-ignore
    const wag = me.mode === 'follow' && near <= DOG.near ? DOG.wag.near : DOG.wag[me.mode];
    stepCrowdBody(w, d.id, d.crowdBody, { at: [a.x, a.y, a.z], velocity: [a.vx, 0, a.vz], yaw: facing, air: !a.grounded, quadruped: { sit: me.mode === 'sit', look, wag } }); // prettier-ignore
    if (me.mode !== 'carry' || !ball) continue;
    const physics = physicsOf(w);
    const at = mouthOf(d).addScaledVector(way.set(a.vx, 0, a.vz), w.dt); // where its mouth will be
    const pull = at
      .sub(physics.readBody(ball.body).position)
      .multiplyScalar(1 / w.dt)
      .clampLength(0, DOG.pull);
    physics.setBody(ball.body, { velocity: [pull.x, pull.y, pull.z], angularVelocity: [0, 0, 0] });
  }
}

/**
 * Stands the dog beside the player's spawn `at` (where he faces `yaw`), facing him, its ball before its paws, and adds
 * its systems.
 */
export function standDog<C extends object>(
  world: World<C>,
  at: readonly [number, number, number],
  yaw: number,
): number {
  const w = world as unknown as World;
  const nav = plainWays(); // the setup sees no props yet: places by the site alone
  const [ahead, left] = [
    [Math.sin(yaw), Math.cos(yaw)],
    [Math.cos(yaw), -Math.sin(yaw)],
  ];
  const clear = (x: number, z: number) => {
    const node = nav.nodeAt(x, at[1], z);
    return node >= 0 ? nav.clearAt(node) : new Vector3(x, at[1], z);
  };
  const [side, front] = DOG.beside;
  const stand = clear(at[0] + left[0] * side + ahead[0] * front, at[2] + left[1] * side + ahead[1] * front);
  const facing = Math.atan2(at[0] - stand.x, at[2] - stand.z); // toward him: it faces him as it stands by him
  const [bx, bz] = [stand.x + Math.sin(facing) * DOG.ball, stand.z + Math.cos(facing) * DOG.ball];
  const there = nav.nodeAt(bx, stand.y, bz);
  const floor = there >= 0 ? nav.clearAt(there).y : NaN;
  // on the dog's own floor; else its tile's clear point
  const lies = Math.abs(floor - stand.y) < 0.05 ? new Vector3(bx, floor, bz) : clear(bx, bz);
  const ball = spawnProp(w, { prop: 'prop:playground-ball', at: [lies.x, lies.y, lies.z], yaw: 0 });
  const components = { dog: { ball }, crowdBody: { rig: 'quadruped', x: stand.x, y: stand.y, z: stand.z, yaw: facing } }; // prettier-ignore
  const id = spawnActor(w, { at: [stand.x, stand.y, stand.z], yaw: facing, character: createCharacter(CHARACTER), player: false, components }); // prettier-ignore
  if (!w.systems.has('dog')) w.systems.add('dog', stepDogs, { phase: 'ai' });
  if (!w.systems.has('dog.body')) w.systems.add('dog.body', poseDogs, { phase: 'readback' });
  return id;
}
