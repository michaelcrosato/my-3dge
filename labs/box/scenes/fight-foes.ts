/**
 * @file The foes' fight, Box 5 (PLAN.md §9.0, WP 6.7): the fight scene's systems for the crowd
 * (labs/box/scenes/fight.ts puts them in the place of the crowd's `crowd.steer` and `crowd.rigs`) and for the bolts.
 * Each kind's attack is its cast's (labs/box/cast/{walker,slime,wisp}.ts: `WALKER_ATTACK`, `SLIME_ATTACK`,
 * `WISP_ATTACK`); its telegraph is `fightTelegraph`, placed where it stands each step while it winds up.
 *
 * - **`fight.steer`** (phase `ai`): the hero's tokens kept to living holders, then each living foe: stunned, it lets
 *   the blow's push carry it; otherwise it steers as the crowd does (the cast's `steerWalker`, `steerSlime`,
 *   `steerWisp`, along the crowd's flow field toward the hero) until its attack starts, and while it plays:
 *   - a walker, granted a token on its ring, swings one of its moves (an `Attack` on the move, its wind-up slowed),
 *     turning to the hero and walking to its stand while its arc fills, lunging in as it strikes; the hero hit if
 *     the arc holds him as the hit window opens;
 *   - a slime, granted a token on its ring, squats while its line fills, then leaps at him, hurting him if it touches
 *     him on the way and bouncing back off; landed (the event `slam`), it rests;
 *   - a wisp, within range, charges while its line fills and it swells, then shoots at his chest, circling him all
 *     the while.
 * - **`fight.rigs`** (phase `anim`): each body's rig stepped as the crowd's are, and told what plays: a walker's swing
 *   (its move at its phase and share, and the fist that trails), its flinch while stunned, and its reactions
 *   (fight-rules.ts: stepped here, a knockdown's fall and get-up or a corpse's death laid over its states); a slime's
 *   squat; a wisp's swell. A walker knocked down acts on nothing until it is up (`fight.steer` lets its push carry it).
 * - **`fight.shots`** (phase `rules`): every bolt flown one swept step (engine/world/projectiles.ts), the hero's
 *   against the living foes and the foes' against him, walls stopping both (the event `hit` where one strikes a
 *   wall); a stopped bolt is despawned.
 *
 * Invariants: what a foe remembers is in its components (a walker's swing is loaded from `fightFoe.attack` and saved
 * back); its choices come from the stream `fight` and the crowd's from `crowd`, in id order.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @see labs/box/scenes/fight.test.ts
 */
import {
  Attack,
  Vector3,
  approachAng,
  floorHeight,
  getMove,
  hop,
  inTelegraph,
  keepTokens,
  knockback,
  launch,
  physicsOf,
  physicsWalls,
  setVelocity,
  stepCrowdBody,
  stepProjectiles,
  stepReactions,
  takeToken,
  type AnimatorInput,
  type CrowdAgent,
  type Physics,
  type TelegraphPlace,
  type World,
} from '../../../engine/sim-api';
import { HERO, HERO_FIGHT } from '../cast/hero';
import { SLIME, SLIME_ATTACK, steerSlime } from '../cast/slime';
import { WALKER_ATTACK, WALKER_SWING, levelWith, steerWalker, type Chase } from '../cast/walker';
import { WISP_ATTACK, steerWisp } from '../cast/wisp';
import { CROWD_GRID } from './crowd-1000';
import { HALL_LEVEL } from './hall';
import {
  breakAttack,
  foeSet,
  heroOf,
  heroSet,
  hurtHero,
  knockedDown,
  strikeFoe,
  type FightComponents,
  type FightFoe,
  type FightTelegraph,
  type FightWorld,
} from './fight-rules';

/** A walker's swing for each of its moves: the move with its wind-up and recovery slowed (`WALKER_ATTACK`). */
const SWINGS = WALKER_ATTACK.moves.map((id) => {
  const { wind, recover } = getMove(id).time;
  return new Attack(id, {
    time: { wind: Math.max(WALKER_ATTACK.wind, wind * 2), recover: recover + WALKER_ATTACK.recover },
  });
});

/** A walker's swing loaded from its component. */
const swingOf = (foe: FightFoe) => SWINGS[foe.move].load(foe.attack);

const STILL = [0, 0, 0] as const;
const [want, to] = [new Vector3(), new Vector3()];
/** The floor's height under (x, z), m. */
const floor = (x: number, z: number) => floorHeight(HALL_LEVEL, x, z);
/** The hero's middle, m above his feet, and his radius. */
const HERO_MIDDLE = HERO.capsule.radius + HERO.capsule.height / 2;

/** What a foe's attack step reads: the world, its body, its own state, the hero and the chase. */
interface FoeTurn {
  w: FightWorld;
  id: number;
  agent: CrowdAgent;
  foe: FightFoe;
  telegraph: FightTelegraph;
  physics: Physics;
  chase: Chase;
  /** The hero: his id, his actor and his attack tokens. */
  hero: number;
  actor: FightComponents['actor'];
  tokens: FightComponents['fightTokens'];
  /** The hero across the floor from it: the unit way to him, and how far (m). */
  way: [number, number];
  distance: number;
}

/** Places a foe's telegraph where it stands now, facing `yaw`, `u` of the way through its wind-up. */
function place(t: FoeTurn, telegraph: string, yaw: number, u: number): TelegraphPlace {
  const { agent } = t;
  Object.assign(t.telegraph, { telegraph, position: [agent.x, floor(agent.x, agent.z), agent.z], yaw, u, size: 1 });
  return t.telegraph;
}

/** A walker's turn (see the file comment). */
function walkerTurn(t: FoeTurn, walker: FightComponents['crowdWalker']): void {
  const { w, id, agent, foe, physics, chase, way, distance } = t;
  if (foe.phase === 'idle') {
    setVelocity(physics, agent, steerWalker(agent, walker, chase, want), w);
    const near = distance < WALKER_ATTACK.stand + 0.75 && levelWith(chase, agent.y);
    if (!near || foe.cool > 0 || !takeToken(t.tokens, id, w.time, w.rng('fight'))) return;
    foe.move = w.rng('fight').int(0, SWINGS.length - 1);
    const swing = SWINGS[foe.move];
    swing.cancel(); // the shared swing may hold another walker's: start from idle
    swing.start();
    [foe.attack, foe.phase] = [swing.save(), 'wind'];
  }
  const swing = swingOf(foe);
  const events = swing.update(w.dt);
  if (swing.phase === 'wind') {
    walker.yaw = approachAng(walker.yaw, Math.atan2(way[0], way[1]), w.dt * WALKER_ATTACK.turn);
    const gap = distance - WALKER_ATTACK.stand;
    const speed = Math.abs(gap) > 0.05 ? Math.sign(gap) * walker.speed * 0.5 : 0;
    setVelocity(physics, agent, want.set(way[0] * speed, 0, way[1] * speed), w);
  } else setVelocity(physics, agent, STILL, w);
  const [sin, cos] = [Math.sin(walker.yaw), Math.cos(walker.yaw)];
  const gap = distance - WALKER_ATTACK.stand;
  if (events.some((event) => event.type === 'active') && gap > 0) {
    const lunge = Math.min(WALKER_ATTACK.lungeMax, Math.sqrt(WALKER_ATTACK.lunge * gap));
    knockback(physics, agent, [sin * lunge, 0, cos * lunge]);
  }
  const placed = place(t, swing.phase === 'wind' ? WALKER_ATTACK.telegraph : '', walker.yaw, swing.u);
  if (swing.hitOpen) {
    const { actor } = t;
    const middle = [actor.x, actor.y + HERO_MIDDLE, actor.z] as const;
    const inside = () => inTelegraph(WALKER_SWING, { ...placed, u: 1 }, middle, HERO.capsule.radius);
    swing.hits([{ id: t.hero }], inside, () => hurtHero(w, WALKER_ATTACK.damage, [agent.x, agent.y, agent.z], id));
  }
  foe.attack = swing.save();
  if (swing.busy) foe.phase = swing.phase === 'wind' ? 'wind' : 'strike';
  else {
    breakAttack(w, id);
    foe.cool = WALKER_ATTACK.cool + w.rng('fight').next() * WALKER_ATTACK.coolSpread;
  }
}

/** A slime's turn (see the file comment). */
function slimeTurn(t: FoeTurn, slime: FightComponents['crowdSlime']): void {
  const { w, id, agent, foe, physics, chase, way, distance } = t;
  if (foe.phase === 'idle') {
    steerSlime(physics, agent, slime, chase);
    const onRing = Math.abs(distance - SLIME.ring.radius) < SLIME.ring.band + SLIME_ATTACK.slack;
    const ready = slime.hop === 'rest' && onRing && levelWith(chase, agent.y) && foe.cool <= 0;
    if (!ready || !takeToken(t.tokens, id, w.time, w.rng('fight'))) return;
    [foe.phase, foe.timer] = ['wind', SLIME_ATTACK.wind];
  }
  if (foe.phase === 'wind') {
    setVelocity(physics, agent, STILL, { dt: w.dt, acceleration: SLIME.brake });
    foe.timer -= w.dt;
    place(t, SLIME_ATTACK.telegraph, Math.atan2(way[0], way[1]), 1 - Math.max(0, foe.timer) / SLIME_ATTACK.wind);
    if (foe.timer > 1e-9) return;
    const reach = distance - SLIME_ATTACK.short;
    const [x, z] = [agent.x + way[0] * reach, agent.z + way[1] * reach];
    const gravity = chase.gravity * agent.gravityScale;
    const leap = reach >= SLIME.least ? hop(agent, to.set(x, floor(x, z), z), SLIME_ATTACK.up, gravity) : null;
    t.telegraph.telegraph = '';
    if (!leap) {
      breakAttack(w, id);
      foe.cool = SLIME_ATTACK.rest;
      return;
    }
    knockback(physics, agent, [leap.x - agent.vx, 0, leap.z - agent.vz]);
    launch(physics, agent, leap.y);
    [slime.hop, slime.timer, foe.phase] = ['air', 0, 'pounce'];
    return;
  }
  steerSlime(physics, agent, slime, chase); // in the air until it lands
  const { actor } = t;
  const touch = SLIME.agent.radius + HERO.capsule.radius + SLIME_ATTACK.touch;
  const level = agent.y < actor.y + HERO_MIDDLE * 2 && agent.y + 2 * SLIME.agent.radius > actor.y;
  if (foe.phase === 'pounce' && distance < touch && level) {
    hurtHero(w, SLIME_ATTACK.damage, [agent.x, agent.y, agent.z], id);
    const back = -(1 + SLIME_ATTACK.bounce);
    knockback(physics, agent, [agent.vx * back, 0, agent.vz * back]);
    launch(physics, agent, SLIME_ATTACK.bounceUp);
    foe.phase = 'strike'; // bounced off: it flies on harmless until it lands
  }
  if (slime.hop === 'air') return;
  breakAttack(w, id);
  slime.timer = SLIME_ATTACK.rest + w.rng('fight').next() * SLIME.restSpread;
  foe.cool = slime.timer;
  w.emit('slam', { position: [agent.x, agent.y, agent.z], size: 0.6 });
}

/** A wisp's turn (see the file comment). */
function wispTurn(t: FoeTurn, wisp: FightComponents['crowdWisp']): void {
  const { w, id, agent, foe, physics, chase, way, distance } = t;
  setVelocity(physics, agent, steerWisp(agent, wisp, chase, want), w);
  if (foe.phase === 'idle') {
    if (foe.cool > 0 || distance > WISP_ATTACK.range) return;
    [foe.phase, foe.timer] = ['wind', WISP_ATTACK.charge];
  }
  foe.timer -= w.dt;
  place(t, WISP_ATTACK.telegraph, Math.atan2(way[0], way[1]), 1 - Math.max(0, foe.timer) / WISP_ATTACK.charge);
  if (foe.timer > 1e-9) return;
  const { actor } = t;
  const from = [agent.x, agent.y + agent.radius, agent.z];
  const [dx, dy, dz] = [actor.x - from[0], actor.y + WISP_ATTACK.chest - from[1], actor.z - from[2]];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const speed = WISP_ATTACK.speed / length;
  w.spawn({
    fightShot: {
      ...{ kind: 'shot', team: 'foe', source: id, x: from[0], y: from[1], z: from[2] },
      ...{ vx: dx * speed, vy: dy * speed, vz: dz * speed },
      ...{ radius: WISP_ATTACK.radius, life: WISP_ATTACK.life, damage: WISP_ATTACK.damage },
    },
  });
  w.emit('shot', { position: [from[0], from[1], from[2]], size: 0.8 });
  breakAttack(w, id);
  foe.cool = WISP_ATTACK.every + w.rng('fight').next() * WISP_ATTACK.spread;
}

/** The system `fight.steer` (see the file comment). */
export function steerFoes(w: FightWorld): void {
  const hero = heroOf(w);
  if (!hero) return;
  const { actor } = hero;
  const physics = physicsOf(w);
  let cell = CROWD_GRID.cellAt(actor.x, actor.z);
  if (cell < 0 || !CROWD_GRID.open[cell]) cell = CROWD_GRID.nearestOpen(actor.x, actor.z);
  const chase: Chase = {
    hero: { x: actor.x, y: actor.y, z: actor.z },
    field: CROWD_GRID.flowField(cell),
    floor,
    time: w.time,
    dt: w.dt,
    gravity: w.settings.get<number>('physics.gravity'),
    rng: w.rng('crowd'),
  };
  keepTokens(hero.fightTokens, (id) => w.get(id)?.crowdMember?.state === 'alive');
  for (const e of w.query('crowdMember', 'fightFoe', 'fightTelegraph')) {
    const { id, crowdMember: agent, fightFoe: foe } = e;
    if (agent.state !== 'alive') {
      if (foe.phase !== 'idle' || e.fightTelegraph.telegraph) breakAttack(w, id);
      continue;
    }
    foe.cool = Math.max(0, foe.cool - w.dt);
    if (foe.stun > 0 || knockedDown(e.reactions)) {
      foe.stun = Math.max(0, foe.stun - w.dt); // knocked, or down: its push carries it
      continue;
    }
    const [dx, dz] = [actor.x - agent.x, actor.z - agent.z];
    const distance = Math.sqrt(dx * dx + dz * dz) || 1e-9;
    const way: [number, number] = [dx / distance, dz / distance];
    const turn: FoeTurn = {
      w,
      id,
      agent,
      foe,
      telegraph: e.fightTelegraph,
      physics,
      chase,
      hero: hero.id,
      actor,
      tokens: hero.fightTokens,
      way,
      distance,
    };
    if (e.crowdWalker) walkerTurn(turn, e.crowdWalker);
    else if (e.crowdSlime) slimeTurn(turn, e.crowdSlime);
    else if (e.crowdWisp) wispTurn(turn, e.crowdWisp);
  }
}

/** The system `fight.rigs` (see the file comment). */
export function fightRigs(w: FightWorld): void {
  const sim = w as unknown as World<FightComponents>; // stepCrowdBody's world: any events
  for (const e of w.query('crowdMember', 'crowdBody', 'fightFoe')) {
    const { id, crowdMember: a, crowdBody: rig, fightFoe: foe } = e;
    if (a.state !== 'alive' && a.state !== 'corpse') continue;
    const velocity = [a.vx, a.vy, a.vz] as const;
    if (e.crowdWalker) {
      const body = e.reactions ? stepReactions(e.reactions, w.dt) : undefined;
      const states: AnimatorInput = {};
      if (a.state === 'corpse') states.pose = 'die';
      else if (knockedDown(e.reactions)) {
        // its reaction tells its body (below)
      } else if (foe.stun > 0) states.hurt = true;
      else if (foe.phase !== 'idle') {
        const swing = swingOf(foe);
        if (swing.phase) states.body = { move: WALKER_ATTACK.moves[foe.move], phase: swing.phase, u: swing.u };
        const trail = swing.trail(false);
        if (trail) states.trail = trail;
      }
      if (body) Object.assign(states, body);
      const at = [a.x, a.y, a.z] as const;
      stepCrowdBody(sim, id, rig, { at, velocity, yaw: e.crowdWalker.yaw, air: !a.grounded, states });
    } else if (e.crowdSlime) {
      const { hop: part } = e.crowdSlime;
      const { squash } = SLIME;
      const crouched = part === 'crouch' || foe.phase === 'wind';
      const s = crouched ? squash.crouch : part === 'rest' ? squash.rest : a.vy > 0 ? squash.rising : squash.falling;
      stepCrowdBody(sim, id, rig, { at: [a.x, a.y, a.z], velocity, blob: { squash: s } });
    } else {
      const swell = foe.phase === 'wind' ? 1 - Math.max(0, foe.timer) / WISP_ATTACK.charge : 0;
      stepCrowdBody(sim, id, rig, { at: [a.x, a.y + a.radius, a.z], velocity, swell });
    }
  }
}

/** The system `fight.shots` (see the file comment). */
export function flyShots(w: FightWorld): void {
  const entities = w.query('fightShot');
  if (entities.length === 0) return;
  const shots = entities.map((e) => e.fightShot);
  const [foes, hero] = [foeSet(w), heroSet(w)];
  const walls = physicsWalls(physicsOf(w));
  const hits = stepProjectiles(shots, { dt: w.dt, targets: (shot) => (shot.team === 'hero' ? foes : hero), walls });
  for (const contact of hits) {
    const shot = shots[contact.shot];
    const at: [number, number, number] = [contact.x, contact.y, contact.z];
    const from = [contact.x - shot.vx * w.dt, contact.y, contact.z - shot.vz * w.dt];
    if (contact.target < 0) w.emit('hit', { position: at, size: 0.5 });
    else if (shot.team === 'hero') {
      const { damage, knockback: push } = { damage: shot.damage, knockback: HERO_FIGHT.bolt.knockback };
      strikeFoe(w, contact.target, { damage, knockback: push, big: false }, from);
    } else hurtHero(w, shot.damage, from, shot.source);
  }
  for (const { id, fightShot } of entities) if (fightShot.state !== 'flying') w.despawn(id);
}
