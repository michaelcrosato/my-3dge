/**
 * @file Crowd bodies (PLAN.md WP 5.1, §4.7; doctrines: Common ground, Reproducible, Quality under the hood): a crowd
 * of dynamic bodies driven by the velocities its AI wants, so the solver resolves the crowd and no separation code is
 * needed. Scenes keep each agent in a component (`CROWD_AGENT_FIELDS`), call these from systems, and never meet
 * Rapier; fixtures/scenes/crowd-1000 is the worked example (1,000 agents pushing toward a point).
 *
 * - **Agents**: capsules or balls (a `flyer` hovers) of `CROWD_MATERIAL`, rotations locked, sliding on everything.
 * - **Queues**: spawn an entity with the component `queued`, its feet at `x`, `y`, `z`; set `state = 'leaving'` to
 *   take it out. `updateCrowd` applies both in list (id) order, adding at most `spawnLimit` bodies a step.
 * - **Intents**: `setVelocity` with an acceleration limit, on the feet only; `knockback` (momentum), `launch`.
 * - **Corpses**: `killAgent` moves an agent to the group `corpse`; `updateCrowd` brakes it and removes it on time.
 * - **Readback**: `updateCrowd`, after the physics step, copies feet and velocity and decides `grounded`.
 * - **Wake and sleep**: still bodies sleep (Rapier 0.21: after about half a second, measured); `setVelocity` keeps
 *   a sleeping agent asleep while it wants to stay still. The lost-body rescue is `rescueLost` (physics/rescue.ts).
 *
 * Invariants: no state beside Rapier's and the agents' (a restore continues exactly); bodies enter Rapier in list
 * order; agents not in the world (`queued`, `gone`) are left alone: the calls return false.
 *
 * Carried from `my-3d2dge:src/stress-world/20-sim.js:174-180, 324-342, 365, 386, 452-459, 502-507` (the bodies,
 * knockback, launches, the dead group, intents, corpses, the grounded heuristic), in SI: 16 units to the metre and
 * the hero's 2,500 mass units to its 70 kg.
 *
 * @example
 * import { createPhysics } from './world';
 * const physics = createPhysics();
 * const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
 * physics.addBody({ type: 'fixed', colliders: [floor] });
 * const walker = { ...CROWD_AGENT, x: 0, y: 0, z: 0 };
 * const slime = { ...CROWD_AGENT, shape: 'ball' as const, radius: 0.375, x: 2, y: 0, z: 0 };
 * const agents = [walker, slime];
 * const sim = { dt: 1 / 60, settings: { get: () => 9.81 } };
 * updateCrowd(physics, agents, sim); // { added: [0, 1], removed: [] }: both bodies enter the world
 * for (let i = 0; i < 60; i++) {
 *   for (const agent of agents) setVelocity(physics, agent, [3, 0, 0], sim);
 *   physics.step(sim);
 *   updateCrowd(physics, agents, sim);
 * }
 * agents[0].vx; // 3: walking east at full speed
 * @see engine/physics/crowd.test.ts
 */
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { codeError } from '../core/log';
import { copyValue, defineSchema, freezeValue, isPlainObject, show } from '../core/schema';
import { bodyId, liveBody } from './capture';
import { groupBits } from './groups';
import { check, vec, type Vec3Like } from './queries';
import { rapierOf, type Physics } from './world';

/**
 * The crowd's material: the prototype's density (1 a cubic unit: a walker weighs about 50 kg), no friction under the
 * min rule (an agent slides on everything), no bounce; a corpse's friction, averaged, so it slides to a stop.
 */
export const CROWD_MATERIAL = Object.freeze({
  /** kg/m³. */
  density: 115,
  friction: 0,
  restitution: 0,
  /** A corpse's friction (the average with what it lies on). */
  corpseFriction: 0.9,
  /** How hard a grounded corpse brakes (m/s²): the prototype's 300 units/s². */
  corpseBrake: 18.75,
});

/** The grounded heuristic's thresholds (m/s, m): the prototype's 6 units/s, 2 units and 1 unit/s. */
export const CROWD_GROUNDED = Object.freeze({ speed: 0.375, height: 0.125, settle: 0.0625 });

/** What `updateCrowd` does at most each step by default: bodies added (shardfall's load ramps), corpses kept. */
export const CROWD_LIMITS = Object.freeze({ spawnLimit: 25, corpseCap: 300 });

/** Below this speed (m/s), a wish does not wake a sleeping agent. */
const REST = 0.05;

/** A crowd agent's fields, for a scene's component: `defineComponent('pusher', { description, fields: … })`. */
export const CROWD_AGENT_FIELDS = defineSchema({
  body: { type: 'integer', default: -1, minimum: -1, description: 'Its body; −1 while queued or gone.' },
  state: {
    type: 'string',
    enum: ['queued', 'alive', 'corpse', 'leaving', 'gone'],
    default: 'queued',
    description: 'queued (waits for its body), alive, corpse, leaving (to be removed), gone (removed).',
  },
  shape: { type: 'string', enum: ['capsule', 'ball'], default: 'capsule', description: 'Its collider.' },
  radius: { type: 'number', default: 0.3125, minimum: 0.01, maximum: 100, unit: 'm', description: 'Its radius.' },
  height: {
    type: 'number',
    default: 1,
    minimum: 0,
    maximum: 100,
    unit: 'm',
    description: 'A capsule’s straight middle (CapsuleGeometry’s height): 1.625 m tall in all by default.',
  },
  flyer: { type: 'boolean', default: false, description: 'Flies: group flyer, no gravity, steered up and down too.' },
  gravityScale: {
    type: 'number',
    default: 3,
    minimum: 0,
    maximum: 100,
    description:
      'How much of physics.gravity it feels: 3 is 29.4 m/s² at 9.81, the prototype’s 30, near characters’ 32.',
  },
  density: { type: 'number', default: 115, minimum: 0.001, unit: 'kg/m³', description: 'Its density.' },
  acceleration: {
    type: 'number',
    default: 31.25,
    minimum: 0,
    unit: 'm/s²',
    description: 'How fast setVelocity changes its velocity (the prototype’s 500 units/s²).',
  },
  corpseTime: { type: 'number', default: 1.6, minimum: 0, unit: 's', description: 'How long its corpse lies.' },
  x: { type: 'number', default: 0, unit: 'm', description: 'Its feet (its lowest point), east.' },
  y: { type: 'number', default: 0, unit: 'm', description: 'Its feet, up.' },
  z: { type: 'number', default: 0, unit: 'm', description: 'Its feet, south.' },
  vx: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, east.' },
  vy: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, up.' },
  vz: { type: 'number', default: 0, unit: 'm/s', description: 'Its velocity, south.' },
  grounded: { type: 'boolean', default: false, description: 'On its feet after the last step (a flyer: always).' },
  dead: { type: 'integer', default: 0, minimum: 0, description: 'Steps since it died, as a corpse.' },
});

/** Where an agent is in its life: see `CROWD_AGENT_FIELDS.state`. */
export type AgentState = 'queued' | 'alive' | 'corpse' | 'leaving' | 'gone';

/** A crowd agent: its body, its make and what the last readback saw (`CROWD_AGENT_FIELDS` says what each means). */
export interface CrowdAgent {
  body: number;
  state: AgentState;
  shape: 'capsule' | 'ball';
  radius: number;
  height: number;
  flyer: boolean;
  gravityScale: number;
  density: number;
  acceleration: number;
  corpseTime: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  dead: number;
}

/** An agent with every field at its default: queued, a walker's capsule at the origin. */
export const CROWD_AGENT: Readonly<CrowdAgent> = freezeValue(
  Object.fromEntries(
    Object.entries(CROWD_AGENT_FIELDS).map(([key, field]) => [key, copyValue(field.default)]),
  ) as unknown as CrowdAgent,
);

/** What the crowd's calls read from the sim: the step length (s). */
export interface CrowdStepper {
  readonly dt: number;
}

/** The Rapier body of an agent in the world; null for one that is not (queued, gone). */
function bodyOf(physics: Physics, agent: CrowdAgent, where: string): RAPIER.RigidBody | null {
  check(isPlainObject(agent), where, agent, 'a crowd agent (CROWD_AGENT_FIELDS)');
  if (agent.state === 'queued' || agent.state === 'gone' || agent.body < 0) return null;
  const found = liveBody(rapierOf(physics), agent.body);
  if (found) return found;
  throw codeError('PHYSICS_NO_BODY', { id: show(agent.body), why: ': remove agents with removeAgent, not removeBody' });
}

/** How far an agent's body origin is above its feet (m). */
const lift = (agent: CrowdAgent): number => (agent.shape === 'ball' ? 0 : agent.height / 2) + agent.radius;

/** A step length above 0, or throws. */
function stepLength(sim: CrowdStepper, where: string): number {
  check(Number.isFinite(sim?.dt) && sim.dt > 0, where, sim?.dt, 'a sim with a step length dt above 0');
  return sim.dt;
}

/** Copies a velocity into the body (waking it) and the agent. */
function setVel(b: RAPIER.RigidBody, agent: CrowdAgent, x: number, y: number, z: number): void {
  b.setLinvel({ x, y, z }, true);
  [agent.vx, agent.vy, agent.vz] = [x, y, z];
}

/**
 * Adds a queued agent's body now (`updateCrowd` does it through the queue), its feet at `x`, `y`, `z`, moving at `vx`,
 * `vy`, `vz`; returns its id. The body never turns (rotations locked: it never tips over), may sleep, and is in the
 * group `crowd` (a flyer: `flyer`, without gravity), its collider of `CROWD_MATERIAL` at the agent's density.
 */
export function addAgent(physics: Physics, agent: CrowdAgent): number {
  check(
    isPlainObject(agent) && agent.state === 'queued',
    'addAgent(agent)',
    agent?.state,
    "an agent in the state 'queued'",
  );
  const { shape, radius, height, density } = agent;
  check(shape === 'capsule' || shape === 'ball', 'addAgent({ shape })', shape, "'capsule' or 'ball'");
  check(Number.isFinite(radius) && radius > 0, 'addAgent({ radius })', radius, 'a radius above 0');
  check(Number.isFinite(height) && height >= 0, 'addAgent({ height })', height, 'a height of 0 or more');
  check(Number.isFinite(density) && density > 0, 'addAgent({ density })', density, 'a density above 0');
  const at = vec([agent.x, agent.y + lift(agent), agent.z], 'addAgent({ x, y, z })');
  const v = vec([agent.vx, agent.vy, agent.vz], 'addAgent({ vx, vy, vz })');
  const world = rapierOf(physics);
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y, at.z)
      .setLinvel(v.x, v.y, v.z)
      .lockRotations()
      .setCanSleep(true)
      .setGravityScale(agent.flyer ? 0 : agent.gravityScale),
  );
  const collider =
    shape === 'ball' ? RAPIER.ColliderDesc.ball(radius) : RAPIER.ColliderDesc.capsule(height / 2, radius);
  const m = CROWD_MATERIAL;
  collider
    .setDensity(density)
    .setFriction(m.friction)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    .setRestitution(m.restitution)
    .setCollisionGroups(groupBits(agent.flyer ? 'flyer' : 'crowd'));
  world.createCollider(collider, b);
  [agent.body, agent.state, agent.grounded, agent.dead] = [bodyId(b.handle), 'alive', agent.flyer, 0];
  return agent.body;
}

/** Removes an agent's body now (`updateCrowd` does it for `leaving` agents and old corpses): it is `gone`. */
export function removeAgent(physics: Physics, agent: CrowdAgent): void {
  if (bodyOf(physics, agent, 'removeAgent(agent)')) physics.removeBody(agent.body);
  [agent.body, agent.state] = [-1, 'gone'];
}

/** How `setVelocity` steers. */
export interface VelocityOptions extends CrowdStepper {
  /** The most its velocity changes per second (m/s²; the agent's `acceleration`): less while stunned. */
  acceleration?: number;
}

/**
 * Moves a living agent's velocity toward `want` by at most `acceleration × dt` this step: across the ground (a
 * flyer: up and down too), keeping the vertical speed gravity and the solver gave it. Only while it is on its feet
 * (`grounded`; a flyer always): a thrown body flies on. A sleeping agent that wants to stay still (under 5 cm/s)
 * stays asleep; any other wish wakes it. True when it steered.
 */
export function setVelocity(physics: Physics, agent: CrowdAgent, want: Vec3Like, options: VelocityOptions): boolean {
  const b = bodyOf(physics, agent, 'setVelocity(agent)');
  const to = vec(want, 'setVelocity(want)');
  const dt = stepLength(options, 'setVelocity({ dt })');
  const rate = options.acceleration ?? agent.acceleration;
  check(Number.isFinite(rate) && rate >= 0, 'setVelocity({ acceleration })', rate, 'an acceleration of 0 or more');
  if (!b || agent.state !== 'alive' || !agent.grounded) return false;
  const up = agent.flyer ? to.y : 0;
  if (b.isSleeping() && Math.sqrt(to.x * to.x + up * up + to.z * to.z) < REST) return false;
  const v = b.linvel();
  let [dx, dy, dz] = [to.x - v.x, agent.flyer ? to.y - v.y : 0, to.z - v.z];
  const gap = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const most = rate * dt;
  if (gap > most) [dx, dy, dz] = [(dx * most) / gap, (dy * most) / gap, (dz * most) / gap];
  setVel(b, agent, v.x + dx, v.y + dy, v.z + dz);
  return true;
}

/** Adds `velocity` (m/s) to an agent or corpse in the world, the same for every mass, waking it. True when it did. */
export function knockback(physics: Physics, agent: CrowdAgent, velocity: Vec3Like): boolean {
  const b = bodyOf(physics, agent, 'knockback(agent)');
  const dv = vec(velocity, 'knockback(velocity)');
  if (!b) return false;
  const v = b.linvel();
  setVel(b, agent, v.x + dv.x, v.y + dv.y, v.z + dv.z);
  return true;
}

/**
 * Throws an agent or corpse up: its upward speed becomes at least `up` (m/s) and its speed across the ground is
 * multiplied by `carry` (1; the prototype's kill launch: 1.3). It is off its feet until it lands. True when it did.
 */
export function launch(physics: Physics, agent: CrowdAgent, up: number, carry = 1): boolean {
  const b = bodyOf(physics, agent, 'launch(agent)');
  check(Number.isFinite(up), 'launch(up)', up, 'an upward speed (m/s)');
  check(Number.isFinite(carry) && carry >= 0, 'launch(carry)', carry, 'a factor of 0 or more');
  if (!b) return false;
  const v = b.linvel();
  setVel(b, agent, v.x * carry, Math.max(v.y, up), v.z * carry);
  agent.grounded = agent.flyer && agent.state !== 'corpse';
  return true;
}

/**
 * Kills an agent: its body joins the group `corpse` (the world and props still stop it; the crowd walks through it)
 * with `CROWD_MATERIAL.corpseFriction`, and a flyer falls. `updateCrowd` removes it `corpseTime` later. True when it
 * did.
 */
export function killAgent(physics: Physics, agent: CrowdAgent): boolean {
  const b = bodyOf(physics, agent, 'killAgent(agent)');
  if (!b || agent.state === 'corpse') return false;
  for (let i = 0; i < b.numColliders(); i++) {
    const collider = b.collider(i);
    collider.setCollisionGroups(groupBits('corpse'));
    collider.setFriction(CROWD_MATERIAL.corpseFriction);
    collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
  }
  if (agent.flyer) b.setGravityScale(agent.gravityScale, true);
  b.wakeUp();
  [agent.state, agent.dead] = ['corpse', 0];
  return true;
}

/** How `updateCrowd` runs. */
export interface CrowdOptions {
  /** The most bodies added this step (25). */
  spawnLimit?: number;
  /** The most corpses kept; the oldest beyond it are removed (300). */
  corpseCap?: number;
  /** The floor's height under (x, z) (a level's `floorHeight`), for the grounded test; without it, speed alone. */
  floor?: (x: number, z: number) => number;
}

/** What one `updateCrowd` changed: indices into the list it was given, in order. */
export interface CrowdChanges {
  /** Agents whose bodies were added (they are `alive`). */
  added: number[];
  /** Agents whose bodies were removed (they are `gone`): despawn their entities. */
  removed: number[];
}

/** Copies a body's feet and velocity into its agent, and decides whether it is on its feet. */
function readBack(b: RAPIER.RigidBody, agent: CrowdAgent, floor: CrowdOptions['floor']): void {
  const [p, v, before] = [b.translation(), b.linvel(), agent.vy];
  [agent.x, agent.y, agent.z, agent.vx, agent.vy, agent.vz] = [p.x, p.y - lift(agent), p.z, v.x, v.y, v.z];
  const near = floor ? agent.y - floor(agent.x, agent.z) < CROWD_GROUNDED.height : false;
  const still =
    Math.abs(agent.vy) < CROWD_GROUNDED.speed && (near || Math.abs(agent.vy - before) < CROWD_GROUNDED.settle);
  agent.grounded = (agent.flyer && agent.state !== 'corpse') || still;
}

/**
 * The crowd's step, after the physics step (the phase `readback`), over every agent in id order: reads each body
 * back (feet, velocity, `grounded`); brakes grounded corpses and removes those `corpseTime` old, then the oldest
 * beyond `corpseCap`; removes `leaving` agents; adds the bodies of up to `spawnLimit` queued agents. Returns the
 * indices of the agents added and removed, so the caller can despawn the removed agents' entities.
 *
 * `grounded` (the prototype's heuristic, `CROWD_GROUNDED`): barely moving up or down, and on the floor (within 12.5
 * cm of `floor(x, z)` when given) or no longer accelerating vertically; a living flyer always is.
 */
export function updateCrowd(
  physics: Physics,
  agents: readonly CrowdAgent[],
  sim: CrowdStepper,
  options: CrowdOptions = {},
): CrowdChanges {
  const dt = stepLength(sim, 'updateCrowd(sim)');
  check(Array.isArray(agents), 'updateCrowd(agents)', agents, 'a list of crowd agents');
  const { spawnLimit = CROWD_LIMITS.spawnLimit, corpseCap = CROWD_LIMITS.corpseCap, floor } = options;
  check(Number.isInteger(spawnLimit) && spawnLimit >= 0, 'updateCrowd({ spawnLimit })', spawnLimit, 'a count');
  check(Number.isInteger(corpseCap) && corpseCap >= 0, 'updateCrowd({ corpseCap })', corpseCap, 'a count');
  check(floor === undefined || typeof floor === 'function', 'updateCrowd({ floor })', floor, 'a function (x, z) => y');
  const [added, removed, corpses] = [[] as number[], [] as number[], [] as number[]];
  const drop = (i: number): void => {
    removeAgent(physics, agents[i]);
    removed.push(i);
  };
  const brake = CROWD_MATERIAL.corpseBrake * dt;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const b = bodyOf(physics, agent, `updateCrowd(agents[${i}])`);
    if (!b) continue;
    if (agent.state === 'leaving') {
      drop(i);
      continue;
    }
    readBack(b, agent, floor);
    if (agent.state !== 'corpse') continue;
    agent.dead++;
    if (agent.dead >= Math.round(agent.corpseTime / dt)) {
      drop(i);
      continue;
    }
    corpses.push(i);
    const speed = Math.sqrt(agent.vx * agent.vx + agent.vz * agent.vz);
    if (!agent.grounded || speed === 0) continue; // at rest: let it sleep
    const k = Math.max(0, speed - brake) / speed;
    setVel(b, agent, agent.vx * k, agent.vy, agent.vz * k);
  }
  if (corpses.length > corpseCap) {
    const oldest = corpses.sort((i, j) => agents[j].dead - agents[i].dead || i - j);
    oldest.slice(0, corpses.length - corpseCap).forEach(drop);
  }
  for (let i = 0; i < agents.length && added.length < spawnLimit; i++) {
    if (agents[i].state !== 'queued') continue;
    addAgent(physics, agents[i]);
    added.push(i);
  }
  return { added, removed: removed.sort((a, b) => a - b) };
}
