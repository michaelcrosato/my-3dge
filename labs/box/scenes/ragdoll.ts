/**
 * @file Ragdolls in the box (PLAN.md WP 10.2): the box room as a physics level (labs/box/scenes/room-hero.ts), the hero
 * at its spawn and four sparring partners (actors on `build:adult`) in a row across the room's south half (`SPOTS`),
 * facing him.
 * Every `RAGDOLL_DEMO.cycle` seconds a blow lands on each in turn (`RAGDOLL_DEMO.blows`): the first from the front,
 * onto its back; the second from behind, onto its face; the third a launch, up and a little east; the fourth a
 * killing one. With `box.ragdoll.handOff` on (the default) each falls as a ragdoll (engine/sim/ragdolls.ts `handOff`)
 * and gets up the way it lies, the dead one lying until the cycle stands it up (`standUp`); off, each falls through
 * its reactions' timelines instead (`knockDown`, `die`, then `getUp`), as the fight's walkers do. At each cycle's start
 * a partner standing is put back on its spot, facing the hero. His `attack` press knocks down the partner nearest in
 * front of him (within `RAGDOLL_DEMO.reach`, 60° of his facing), along his facing. `box.ragdoll.push` sets the blows'
 * strength (m/s).
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @example
 * // node x sim labs/box/scenes/ragdoll --steps 360
 * // node x replay tests/replays/ragdoll-falls.replay.json --browser sim
 * ragdoll.id; // 'box:ragdoll'
 * @see labs/box/scenes/ragdoll.test.ts
 */
import { addLevelBodies, addRagdolls, createCharacter, defineComponent, defineScene, defineSettings, handOff, physicsOf, placeActor, pressed, reactTo, spawnActor, standUp, Vector3, type RagdollState, type World } from '../../../engine/sim-api'; // prettier-ignore
import { spawnHero } from '../cast/hero';
import { boxSounds } from '../sounds/events';
import { ROOM_HERO_LEVEL } from './room-hero';

/** The scene's settings, read when it starts. */
export const RAGDOLL_SETTINGS = defineSettings({
  'box.ragdoll.handOff': {
    type: 'boolean',
    default: true,
    when: 'scene',
    description: 'Whether a hard blow or a death hands a partner off to its ragdoll (else its reactions’ timelines).',
  },
  'box.ragdoll.push': {
    type: 'number',
    default: 3.5,
    minimum: 0,
    maximum: 12,
    unit: 'm/s',
    when: 'scene',
    description: 'How hard the blows land: the speed they give a partner, along the blow.',
  },
});

/** The demo's numbers: the cycle (s), each partner's blow (when, s into the cycle, and its push in units of the
 * `push` setting, +Z south), when the dead one stands (s), and the hero's reach (m). */
export const RAGDOLL_DEMO = {
  cycle: 8,
  blows: [
    { at: 0.5, push: [0, 0.25, 1], dead: false }, // from the front (the hero's side): onto its back
    { at: 1.5, push: [0, 0.25, -1], dead: false }, // from behind: onto its face
    { at: 2.5, push: [0.25, 1.5, 0], dead: false }, // a launch, up and a little east
    { at: 3.5, push: [0, 0.1, 0.75], dead: true }, // a killing one
  ],
  stand: 6,
  reach: 2.5,
} as const;

/**
 * Where the partners stand (x, z), facing north to the hero, in their blows' order, each with room to fall its own way
 * on open floor the room's camera sees: the first back, south, west of the low wall; the second forward, north, 4.5 m
 * short of the pillar; the third up and a little east, just behind the low wall; the last back, south, east of it.
 */
const SPOTS = [[2.5, 6], [13, 9.5], [6.5, 7.5], [11, 6.5]] as const; // prettier-ignore
const NORTH = Math.PI;

/** A partner: its index (its blow) and its spot. */
export const PARTNER = defineComponent('boxPartner', {
  description: 'A sparring partner of box:ragdoll: which blow it takes, and the spot it stands on.',
  fields: {
    index: { type: 'number', default: 0, description: 'Its blow in RAGDOLL_DEMO.blows.' },
    x: { type: 'number', default: 0, unit: 'm', description: 'Its spot, east.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'Its spot, south.' },
  },
});

/** The scene's components, typed. */
type Partner = { id: number; boxPartner: { index: number; x: number; z: number }; actor: { x: number; z: number; yaw: number }; ragdoll?: RagdollState }; // prettier-ignore

/** Lands a blow of `push` (m/s) on partner `id`: its ragdoll, or its timelines with the setting off. */
function blow(w: World, id: number, push: readonly number[], dead: boolean): void {
  const along = new Vector3(push[0], push[1], push[2]);
  if (w.settings.get<boolean>('box.ragdoll.handOff')) {
    handOff(w, id, { push: along, dead });
    return;
  }
  const yaw = (w.get(id) as unknown as Partner).actor.yaw;
  reactTo(w, id, (r) => (dead ? r.die(along, yaw) : r.knockDown(along, yaw)));
}

/** The system `partners`: each cycle's blows, the dead one stood up, the partners back on their spots, the hero's attack. */
function partners(w: World, intents: Parameters<typeof pressed>[0]): void {
  const every = Math.round(RAGDOLL_DEMO.cycle / w.dt);
  const tick = w.tick % every;
  const strength = w.settings.get<number>('box.ragdoll.push');
  for (const p of w.query('boxPartner', 'actor') as unknown as Partner[]) {
    const { index, x, z } = p.boxPartner;
    const { at, push, dead } = RAGDOLL_DEMO.blows[index];
    if (tick === 0 && !p.ragdoll) placeActor(w, p.id, [x, 0, z], NORTH);
    if (tick === Math.round(at / w.dt))
      blow(
        w,
        p.id,
        push.map((v) => v * strength),
        dead,
      );
    if (tick === Math.round(RAGDOLL_DEMO.stand / w.dt) && dead) {
      if (!standUp(w, p.id)) reactTo(w, p.id, (r) => r.getUp());
    }
  }
  if (!pressed(intents, 'attack')) return;
  const hero = w.get(1) as unknown as Partner | undefined;
  if (!hero?.actor) return;
  const [fx, fz] = [Math.sin(hero.actor.yaw), Math.cos(hero.actor.yaw)];
  let nearest: Partner | null = null;
  let near: number = RAGDOLL_DEMO.reach;
  for (const p of w.query('boxPartner', 'actor') as unknown as Partner[]) {
    const [dx, dz] = [p.actor.x - hero.actor.x, p.actor.z - hero.actor.z];
    const d = Math.hypot(dx, dz);
    if (d < near && d > 1e-6 && (dx * fx + dz * fz) / d > Math.cos(Math.PI / 3)) [nearest, near] = [p, d];
  }
  if (nearest) blow(w, nearest.id, [fx * strength, 0.4 * strength, fz * strength], false);
}

/** Where the hero starts: the level's spawn `@`. */
const START = ROOM_HERO_LEVEL.spawns.find((spawn) => spawn.name === 'hero')!.position;

/** The box scene `box:ragdoll`. */
export const ragdoll = defineScene('box:ragdoll', {
  description: 'Ragdolls: four partners fall to blows from the front, from behind, a launch and a death, and get up.',
  level: 'level:room',
  sounds: boxSounds(ROOM_HERO_LEVEL),
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), ROOM_HERO_LEVEL);
    spawnHero(w, [START[0], START[1], START[2]], 0);
    SPOTS.forEach(([x, z], index) => {
      const components = { boxPartner: { index, x, z } };
      spawnActor(w, { at: [x, 0, z], yaw: NORTH, character: createCharacter(), player: false, anim: { build: 'build:adult' }, components }); // prettier-ignore
    });
    addRagdolls(w);
    w.systems.add('partners', partners as (w: World, intents: unknown) => void, { phase: 'rules' });
  },
});

export default ragdoll;
