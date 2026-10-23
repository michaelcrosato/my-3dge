/**
 * @file The playground's sound events (docs/PLAYGROUND.md §8.1, PLAN.md WP 13.22): which effects each of its sim
 * events plays, how loud, at what pitch and where, from the engine's foley (engine/audio/data/foley.ts) and its own
 * (effects.ts beside it). The sound comes from the sim's events, never the page's state, so a run's sound timeline is
 * a pure function of the run: a replay gives the same timeline in Node and in Chromium (tests/e2e/
 * playground-audio.spec.ts), and the page plays exactly that (labs/playground/sounds/page.ts).
 *
 * - The body, where its event says it happened (`at`): `footstep`, the step the surface under the feet plays at the
 *   gait (its movement model's, else by speed: engine/world/footsteps.ts; a slide's feet make none); `jump` a step
 *   pushing off; `land` a body landing and a step, louder the harder; `move` what it begins (a mantle, a climber's
 *   grip, a ladder's rung, the zipline's hook, a whoosh into a skydive, a slide, clothes as it crouches and stands);
 *   `dash` a whoosh; `launch` the pad's.
 * - Hands: `pickup` and `use` a grab; `throw` and `melee` a swish, a kick's louder; `strike` the blow landing: on a
 *   person or a thing a kick's or a punch's by the move's limb, on any other prop its make's impact.
 * - The house: `door` opening, closing or rattled locked (a window or a tilting door sliding); `switch` a click;
 *   `splinters`, `glass` and `shatter` a door broken off, a pane breaking, any other prop breaking (its make's).
 * - Guns: `gunshot` its weapon's `sound` at the muzzle and, where it struck, an impact by what it struck (a person; a
 *   prop by its make; the ground by its surface, a wall as concrete), but a thing, whose `thingHit` sounds; `reload`,
 *   `dry`, `draw` and `holster`. Things: `thingHit` its prop's make struck (a hit that downs it, its `thingDown`
 *   falling: one sound, not two at once), `thingUp` back up.
 * - People: `damage` a grunt where it struck; `ragdoll` a body falling; `getUp` the effort; `neighbour` (`look` and
 *   `aside` a hum, `shoved` a hey, `startle` a gasp, `flinch` clothes, `fall` a whoosh, `sit` a sigh, `rise` a soft
 *   grunt); `action`, a seated action's beats (clothes as it lowers and settles, the bench creaking as it takes the
 *   weight and gives it back); `dog` (`follow` its tags, `sit` and `fetch` a huff, `chase` a bark, `drop` its ball
 *   bouncing, `wait` a whine). Every other event plays nothing.
 *
 * `soundsOf(record, world, ground)` maps one traced event on a scene's ground (the site's, ground.ts; a level's,
 * `levelGround`; a terrain's, `terrainGround`); `createSoundReader(ground).read(world)` the events a world delivered
 * since the last read, each once by its `seq`; `timelineHash` hashes a timeline (FNV-1a, 64 bits, over its JSON);
 * `playgroundSounds(ground)` is the map as a scene's `sounds` hook, so `x audio --replay` mixes what the page plays.
 *
 * Invariants: pure reads (nothing here changes the world or plays a sound); positions are world space, metres, as
 * the sim gives them, so the same run gives the same bits everywhere. Sim-side: it imports only engine/sim-api.ts.
 *
 * @example
 * const reader = createSoundReader({ surface: () => 'wood', room: () => null }); // a scene's ground: wooden floors
 * // after each step: reader.read(session.world) → [{ step: 31, type: 'footstep', sfx: 'sfx:stepWood', … }]
 * timelineHash([]); // '09612b07b5ecb5a5': the JSON '[]' hashed
 * @see labs/playground/sounds/events.test.ts
 */
import { footstepSound, getMove, getProp, getThing, getWeapon, stepGait, surfaceBelow, terrainSurface, type CompiledLevel, type PropPart, type SceneSound, type StepGait, type Terrain, type TraceRecord } from '../../../engine/sim-api'; // prettier-ignore

/** A point in the world, metres. */
export type Point = readonly [number, number, number];

/** One sound the playground plays for a sim event. Plain data. */
export interface PlaygroundSound {
  /** The step it was read at, and the sim event it comes from. */
  readonly step: number;
  readonly type: string;
  /** The effect, its gain (0 to 1) and its pitch ratio. */
  readonly sfx: string;
  readonly vol: number;
  readonly pitch: number;
  /** Where it sounds, or null: unplaced, in the listener's head. */
  readonly position: Point | null;
}

/** What a room is made of, for `roomAcoustics` (engine/audio/runtime/reverb.ts `RoomMake`), and its name. */
export interface PlaygroundRoom {
  readonly name: string;
  readonly area: number;
  readonly height: number;
  readonly floor: string;
  readonly walls?: string;
  readonly contents?: number;
}

/** A scene's ground: the footstep surface under feet at (x, y, z), and the room there (null in the open air). */
export interface PlaygroundGround {
  surface(x: number, y: number, z: number): string;
  room(x: number, y: number, z: number): PlaygroundRoom | null;
}

/** What the reader reads of a world: its step, its event trace and its entities. */
export interface SoundWorld {
  readonly tick: number;
  readonly events: { trace(): readonly TraceRecord[] };
  get(id: number): unknown;
}

/** What a thing sounds as when struck. */
export type Make = 'wood' | 'metal' | 'concrete' | 'glass' | 'soft' | 'dirt';

/** Each make's impact. */
export const IMPACTS: Readonly<Record<Make, string>> = { wood: 'sfx:impactWood', metal: 'sfx:impactMetal', concrete: 'sfx:impactConcrete', glass: 'sfx:impactGlass', soft: 'sfx:impactBody', dirt: 'sfx:impactDirt' }; // prettier-ignore

/** Materials (engine/gfx/materials) by make; any other is concrete's. */
export const MAKES: Readonly<Record<string, Make>> = { 'material:wood': 'wood', 'material:planks': 'wood', 'material:crate': 'wood', 'material:barrelStaves': 'wood', 'material:iron': 'metal', 'material:paint': 'metal', 'material:glass': 'glass', 'material:cloth': 'soft' }; // prettier-ignore

/** Surface tags by make, where a shot strikes the ground; any other is concrete's. */
export const SURFACE_MAKES: Readonly<Record<string, Make>> = { wood: 'wood', carpet: 'soft', metal: 'metal', iron: 'metal', steel: 'metal', grass: 'dirt', dirt: 'dirt', sand: 'dirt', mud: 'dirt', gravel: 'dirt' }; // prettier-ignore

/** What a movement it begins plays (engine/physics/character.ts `MoveEntered`), and how loud. */
const MOVES: Readonly<Record<string, readonly [string, number]>> = { mantle: ['sfx:mantle', 0.8], climb: ['sfx:climbGrip', 0.7], ladder: ['sfx:ladderRung', 0.7], zipline: ['sfx:zipAttach', 0.8], skydive: ['sfx:swish', 1], slide: ['sfx:slide', 0.8], crouch: ['sfx:crouchCloth', 0.5], stand: ['sfx:crouchCloth', 0.35] }; // prettier-ignore

/** A neighbour's reactions (labs/playground/cast/neighbours.ts), the dog's (dog.ts) and a seated action's beats. */
const NEIGHBOUR: Readonly<Record<string, readonly [string, number]>> = { look: ['sfx:playgroundHm', 0.8], aside: ['sfx:playgroundHm', 0.5], shoved: ['sfx:playgroundHey', 1], startle: ['sfx:playgroundGasp', 1], flinch: ['sfx:crouchCloth', 0.6], fall: ['sfx:swish', 0.8], sit: ['sfx:playgroundSigh', 0.8], rise: ['sfx:playgroundGrunt', 0.4] }; // prettier-ignore
const DOG: Readonly<Record<string, readonly [string, number]>> = { follow: ['sfx:playgroundTags', 0.8], sit: ['sfx:playgroundHuff', 0.7], chase: ['sfx:playgroundBark', 1], fetch: ['sfx:playgroundHuff', 0.8], drop: ['sfx:playgroundBounce', 0.9], wait: ['sfx:playgroundWhine', 0.8] }; // prettier-ignore
const BEATS: Readonly<Record<string, readonly [string, number]>> = { lower: ['sfx:crouchCloth', 0.4], seated: ['sfx:playgroundCreak', 0.8], rise: ['sfx:playgroundCreak', 0.5], end: ['sfx:crouchCloth', 0.3] }; // prettier-ignore

/** An event's payload as the map reads it (every field optional). */
type Payload = { id?: number; what?: string; type?: string; speed?: number; gait?: string; open?: boolean; locked?: boolean; move?: string; target?: number; weapon?: string; thing?: string; outcome?: string; prop?: string; from?: Point; to?: Point; normal?: Point | null; at?: Point; position?: Point; killed?: boolean }; // prettier-ignore
/** A sound without its step and type. */
type Sound = Omit<PlaygroundSound, 'step' | 'type'>;
/** What an entity holds that the map reads. */
type Held = { actor?: { x: number; y: number; z: number }; motion?: { gait: string }; sceneProp?: { prop: string; x: number; y: number; z: number }; crowdBody?: { x: number; y: number; z: number }; door?: { hinge: Point; slide: Point; tilt: boolean }; thing?: object }; // prettier-ignore

/** A sound of `sfx` at gain `vol`, placed at `position` (unplaced without one), at `pitch`. */
const sound = (sfx: string, vol: number, position: Point | null | undefined, pitch = 1): Sound => ({ sfx, vol, pitch, position: position ?? null }); // prettier-ignore

/** `value` held to [low, high]. */
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** `at` raised `up` m. */
const above = (at: Point | null, up: number): Point | null => (at ? [at[0], at[1] + up, at[2]] : null);

/** Where an actor's body event happened: its `at` (engine/sim/actors.ts), else where the actor is now. */
const feetOf = (world: SoundWorld, p: Payload): Point | null => p.at ?? whereIs(world, p.id);

/** Where entity `id` is: an actor's feet, a prop's centre, a crowd body's feet; null once it is gone. */
function whereIs(world: SoundWorld, id: number | undefined): Point | null {
  const e = id === undefined ? undefined : (world.get(id) as Held | undefined);
  const at = e?.actor ?? e?.sceneProp ?? e?.crowdBody;
  return at ? [at.x, at.y, at.z] : null;
}

/** Where a blow meets entity `id`: a person's chest, 1 m over its feet; a prop's or a thing's centre. */
function middleOf(world: SoundWorld, id: number | undefined): Point | null {
  const at = whereIs(world, id);
  return (world.get(id ?? -1) as Held | undefined)?.actor ? above(at, 1) : at;
}

/** A part's rough size, m³: a box's, or a round part's by its radii and length (0 for one it cannot size). */
function partSize({ params }: PropPart): number {
  const n = (key: string) => { const v = (params as Record<string, unknown> | undefined)?.[key]; return typeof v === 'number' ? v : 0; }; // prettier-ignore
  if (n('width') > 0) return n('width') * n('height') * n('depth');
  const r = (n('radiusBottom') + n('radiusTop') + n('radiusStart') + n('radiusEnd')) / 2 || n('radius');
  return Math.PI * r * r * (n('height') + n('length') || 2 * r);
}

/** What prop `id` sounds as: its biggest part's material's make (`MAKES`: wood, metal, concrete, glass or soft). */
export function propMake(id: string): Make {
  const parts = getProp(id).parts;
  const biggest = parts.reduce<PropPart | undefined>((best, part) => (!best || partSize(part) > partSize(best) ? part : best), undefined); // prettier-ignore
  return (biggest && MAKES[biggest.material]) || 'concrete';
}

/** What entity `id` sounds as when struck: a person soft, a prop or a thing its prop's make, the world null. */
function makeOf(world: SoundWorld, id: number | undefined): Make | null {
  const e = id === undefined || id < 0 ? undefined : (world.get(id) as Held | undefined);
  if (!e) return null;
  return e.actor ? 'soft' : e.sceneProp ? propMake(e.sceneProp.prop) : null;
}

/** The step an actor's foot plays, where the event says it was (else where it is): at the gait the event names (its
 * movement model's), else `told`, else by its speed; on the ground there. */
function stepOf(world: SoundWorld, ground: PlaygroundGround, p: Payload, told?: StepGait): Sound | null {
  const feet = feetOf(world, p);
  const known = told ?? (p.gait && p.gait !== 'idle' ? (p.gait as StepGait) : stepGait(p.speed ?? 0));
  const step = feet && footstepSound(ground.surface(feet[0], feet[1], feet[2]), known);
  return step ? sound(step.sfx, step.vol, feet, step.pitch) : null;
}

/** A table's sound for `key`, at `at`. */
const fromTable = (table: Readonly<Record<string, readonly [string, number]>>, key: string | undefined, at: Point | null) => (key !== undefined && Object.hasOwn(table, key) ? [sound(table[key][0], table[key][1], at)] : []); // prettier-ignore

/** The blow a move lands: a kick's by the foot, else a punch's. */
const blowOf = (move: string | undefined) => (move && getMove(move).limb === 'footR' ? 'sfx:kickHit' : 'sfx:punchHit');

/** Where a shot struck the world: the ground by its surface, a wall (a steep face that is not soft ground) concrete. */
function groundMake(ground: PlaygroundGround, to: Point, normal: Point): Make {
  const make = SURFACE_MAKES[ground.surface(to[0], to[1], to[2])] ?? 'concrete';
  return normal[1] > 0.7 || make === 'dirt' ? make : 'concrete';
}

/** The sounds each event type plays (see the file comment). */
const SOUNDS: Readonly<Record<string, (p: Payload, world: SoundWorld, ground: PlaygroundGround) => (Sound | null)[]>> =
  {
    footstep: (p, world, ground) => [stepOf(world, ground, p)],
    jump: (p, world, ground) => [stepOf(world, ground, p, 'run')],
    land: (p, world, ground) => [sound('sfx:landBody', clamp((p.speed ?? 0) / 9, 0.3, 1), feetOf(world, p)), stepOf(world, ground, p, 'run')], // prettier-ignore
    move: (p, world) => fromTable(MOVES, p.what, feetOf(world, p)),
    dash: (p, world) => [sound('sfx:swish', 0.8, above(feetOf(world, p), 1))],
    launch: (p, world) => [sound('sfx:launch', 1, feetOf(world, p))],
    pickup: (p, world) => [sound('sfx:grab', 0.6, above(whereIs(world, p.id), 1))],
    use: (p, world) => [sound('sfx:grab', 0.35, whereIs(world, p.target) ?? above(whereIs(world, p.id), 1))],
    throw: (p, world) => [sound('sfx:swish', 0.7, above(whereIs(world, p.id), 1.2))],
    melee: (p, world) => [sound('sfx:swish', blowOf(p.move) === 'sfx:kickHit' ? 0.9 : 0.6, above(whereIs(world, p.id), 1))], // prettier-ignore
    strike: (p, world) => {
      const make = makeOf(world, p.target);
      const soft = make === 'soft' || (world.get(p.target ?? -1) as Held | undefined)?.thing !== undefined;
      const kick = blowOf(p.move) === 'sfx:kickHit';
      return [sound(soft || !make ? blowOf(p.move) : IMPACTS[make], kick ? 1 : 0.8, middleOf(world, p.target))];
    },
    door: (p, world) => {
      const door = (world.get(p.id ?? -1) as Held | undefined)?.door;
      const at = door ? above(door.hinge, 1) : whereIs(world, p.id);
      const slides = door !== undefined && (door.tilt || door.slide.some((v) => v !== 0));
      return [sound(p.locked ? 'sfx:doorLocked' : slides ? 'sfx:windowSlide' : p.open ? 'sfx:doorOpen' : 'sfx:doorClose', 0.8, at)]; // prettier-ignore
    },
    switch: (p, world) => [sound('sfx:switchClick', 0.7, whereIs(world, p.id))],
    splinters: (p) => [sound('sfx:doorBreak', 1, p.position)],
    glass: (p) => [sound('sfx:glassBreak', 1, p.position)],
    shatter: (p) => [sound(IMPACTS[p.prop ? propMake(p.prop) : 'wood'], 1, p.position)],
    gunshot: (p, world, ground) => {
      const shot = sound(p.weapon ? getWeapon(p.weapon).sound : 'sfx:pistolShot', 0.8, p.from);
      if (!p.to || !p.normal || (world.get(p.target ?? -1) as Held | undefined)?.thing !== undefined) return [shot];
      return [shot, sound(IMPACTS[makeOf(world, p.target) ?? groundMake(ground, p.to, p.normal)], 0.6, p.to)];
    },
    reload: (p, world) => [sound('sfx:reload', 0.7, above(whereIs(world, p.id), 1.2))],
    dry: (p, world) => [sound('sfx:dryFire', 0.6, above(whereIs(world, p.id), 1.2))],
    draw: (p, world) => [sound('sfx:drawGun', 0.6, above(whereIs(world, p.id), 1))],
    holster: (p, world) => [sound('sfx:holsterGun', 0.6, above(whereIs(world, p.id), 1))],
    thingHit: (p, world) => (p.outcome === 'down' ? [] : [sound(IMPACTS[p.thing ? propMake(getThing(p.thing).prop) : 'metal'], 0.8, whereIs(world, p.id))]), // prettier-ignore
    thingDown: (p, world) => {
      const make = p.thing ? propMake(getThing(p.thing).prop) : 'metal';
      return [make === 'soft' ? sound('sfx:bodyFall', 0.9, whereIs(world, p.id)) : sound(IMPACTS[make], 0.8, whereIs(world, p.id), 0.8)]; // prettier-ignore
    },
    thingUp: (p, world) => [sound(IMPACTS[p.thing ? propMake(getThing(p.thing).prop) : 'metal'], 0.35, whereIs(world, p.id))], // prettier-ignore
    damage: (p) => [sound('sfx:playgroundGrunt', p.killed ? 1 : 0.8, p.at)],
    ragdoll: (p, world) => [sound('sfx:bodyFall', 1, whereIs(world, p.id))],
    getUp: (p, world) => [sound('sfx:playgroundGrunt', 0.5, above(whereIs(world, p.id), 1))],
    neighbour: (p, world) => fromTable(NEIGHBOUR, p.what, above(whereIs(world, p.id), 1.6)),
    action: (p, world) => fromTable(BEATS, p.type, above(whereIs(world, p.id), 0.5)),
    dog: (p, world) => fromTable(DOG, p.what, above(whereIs(world, p.id), 0.4)),
  };

/** The event types that play sounds, in the order the file comment gives them. */
export const SOUND_EVENTS: readonly string[] = Object.keys(SOUNDS);

/** The sounds one traced event plays in `world` on `ground` (read at `world.tick`): none for most events' quiet kinds. */
export function soundsOf(record: TraceRecord, world: SoundWorld, ground: PlaygroundGround): PlaygroundSound[] {
  const map = Object.hasOwn(SOUNDS, record.type) ? SOUNDS[record.type] : undefined;
  const payload = record.payload;
  if (!map || typeof payload !== 'object' || payload === null) return [];
  return map(payload as Payload, world, ground).flatMap((made) => (made ? [{ step: world.tick, type: record.type, ...made }] : [])); // prettier-ignore
}

/** A scene's `sounds` hook on `ground`: each event's effects and gains, as the page plays them. */
export function playgroundSounds(ground: PlaygroundGround): (record: TraceRecord, world: SoundWorld) => SceneSound[] {
  return (record, world) => soundsOf(record, world, ground).map(({ sfx, vol }) => ({ sfx, vol }));
}

/** A level's ground: its surface tags (engine/world/level `surfaceBelow`), no rooms. */
export const levelGround = (level: CompiledLevel): PlaygroundGround => ({ surface: (x, y, z) => surfaceBelow(level, x, y + 0.05, z), room: () => null }); // prettier-ignore

/** A terrain's ground: its surface (grass, rock where steep), no rooms. */
export const terrainGround = (terrain: Terrain): PlaygroundGround => ({ surface: (x, _y, z) => terrainSurface(terrain, x, z), room: () => null }); // prettier-ignore

/** Reads a world's new events as sounds (see the file comment). */
export interface SoundReader {
  /** The sounds of the events `world` delivered since the last read, in order. */
  read(world: SoundWorld): PlaygroundSound[];
  /** Events that left the world's trace (its latest 256) before they were read: 0 when every one was heard. */
  readonly missed: number;
}

/** A reader that reads each event of a world once, on `ground` (see the file comment). */
export function createSoundReader(ground: PlaygroundGround): SoundReader {
  let [read, seen, missed]: [SoundWorld | null, number, number] = [null, 0, 0];
  return {
    get missed() {
      return missed;
    },
    read(world) {
      if (world !== read) [read, seen] = [world, 0];
      const records = world.events.trace();
      const fresh = records.filter((record) => record.seq > seen);
      if (fresh.length && fresh[0].seq > seen + 1) missed += fresh[0].seq - seen - 1;
      seen = records.at(-1)?.seq ?? seen;
      return fresh.flatMap((record) => soundsOf(record, world, ground));
    },
  };
}

const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** A timeline's hash: FNV-1a, 64 bits, over its JSON's UTF-16 code units, as 16 hex digits. */
export function timelineHash(events: readonly PlaygroundSound[]): string {
  const text = JSON.stringify(events);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) hash = ((hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME) & MASK;
  return hash.toString(16).padStart(16, '0');
}
