/**
 * @file The physics-props fixture scene (PLAN.md WP 4.1): the props, movers, triggers and rescue of
 * engine/physics/bodies.ts in a walled room, proven against golden hashes in Node and in Chromium.
 *
 * - The hero stands on a `platform`, a mover that carries it 6 m east and back every 8 s, waiting 1 s at each end;
 *   with `props.lift` on, 2 m up and back down instead (`LIFT`), so he rides a vertical mover and sinks with it
 *   (engine/physics/move.ts `sink`; tests/replays/physics-props-lift.replay.json).
 * - Two stacks of crates (0.75 m, the prototype's) stand on the floor, four high and three high. A `knock` intent is
 *   a swing west of them, at `SWING`: it knocks every prop within `REACH` of it (the taller stack) with the
 *   prototype's sword hit, each twist drawn from the sim stream `knock`, and both stacks topple east.
 * - Two `zone`s are triggers: `gate`, at the platform's far end, and `pit`, where the crates fall. Each emits `enter`
 *   and `leave` events `{ zone, body }`.
 * - The rescue runs every step: the dev action `sink` drops the barrel under the floor (a body that fell through),
 *   and the rescue puts it back on the nearest walkable tile, emitting `rescued` `{ body }`.
 *
 * Its dev action `roundtrip` takes the physics world's capture and restores it in place from its text form; the
 * replay runs it at step 90, mid-ride and while the crates fall, and its goldens are those of the run without it
 * (index.test.ts), so `x replay --browser sim` proves the restore continues exactly in Node and in Chromium.
 *
 * Game code: it imports only engine/sim-api.ts. Systems: `platforms` (phase `ai`, before the actors move) drives the
 * movers; `zones` and `rescue` (phase `readback`, after the physics step) update the triggers and rescue lost bodies.
 *
 * Tests: tests/replays/physics-props.replay.json (`node x replay tests/replays/physics-props.replay.json --browser
 * sim`), fixtures/scenes/physics-props/index.test.ts. Try it: `node x sim fixtures/scenes/physics-props --steps 600`.
 */
import {
  addBox,
  addCylinder,
  addLevelBodies,
  addSensor,
  compileLevel,
  createCharacter,
  defineComponent,
  defineScene,
  defineSettings,
  driveMover,
  knock,
  MOVER_FIELDS,
  moverPose,
  physicsOf,
  pressed,
  rescueLost,
  spawnActor,
  TRIGGER_FIELDS,
  updateTrigger,
  type Mover,
  type Trigger,
  type World,
} from '../../../engine/sim-api';

/** The room: 18 × 10 m, walled (3 m), 16 × 8 m inside. */
export const ROOM = compileLevel(
  [
    '---',
    'description: The walled room of the physics-props fixture.',
    '---',
    '##################',
    ...Array.from({ length: 8 }, () => '#................#'),
    '##################',
  ].join('\n'),
  { file: 'physics-props.txt' },
);

/** A crate's size (m): the prototype's 12 units. */
export const CRATE = 0.75;

/** The platform's path: from x 3 to x 9 and back every 8 s, waiting 1 s at each end, eased. */
export const RIDE: Omit<Mover, 'body'> = {
  origin: [3, 0.2, 3],
  offset: [6, 0, 0],
  period: 8,
  phase: 0,
  hold: 0.25,
  smooth: true,
  yaw: 0,
  spin: 0,
};

/** The lift: the same platform riding 2 m up and back down instead (`props.lift`). */
export const LIFT: Omit<Mover, 'body'> = { ...RIDE, offset: [0, 2, 0] };

/** The scene's settings. */
export const PROPS_SETTINGS = defineSettings({
  'props.lift': {
    type: 'boolean',
    default: false,
    when: 'scene',
    description:
      'The platform rides 2 m up and back down instead of east (LIFT): the hero rides a vertical mover, down through the controller’s sink. Off by default, so the replay physics-props keeps its goldens.',
  },
});

/** The stacks: where each stands (x, z) and how high. The swing reaches the taller one. */
export const STACKS = [
  { x: 12, z: 6.5, height: 4 },
  { x: 12.8, z: 6.6, height: 3 },
] as const;

/** Where the `knock` swing strikes from (x, z), and how far it reaches across the ground (m). */
export const SWING = [11, 6.5] as const;
export const REACH = 1.25;

/** Where the barrel stands (x, z): a tile's centre. */
export const BARREL = [5.5, 6.5] as const;

/** The fixture's components: movers, trigger zones and props. */
export const PLATFORM = defineComponent('platform', {
  description: 'A mover of the physics-props fixture: a kinematic platform whose pose is a function of time.',
  fields: MOVER_FIELDS,
});
export const ZONE = defineComponent('zone', {
  description: 'A trigger zone of the physics-props fixture: its name, its sensor and the bodies inside.',
  fields: { name: { type: 'string', default: '', description: 'Its name, in its events.' }, ...TRIGGER_FIELDS },
});
export const PROP = defineComponent('prop', {
  description: 'A prop of the physics-props fixture: its body, its kind, and its place in a stack.',
  fields: {
    body: { type: 'integer', default: -1, minimum: -1, description: 'Its body.' },
    kind: { type: 'string', enum: ['crate', 'barrel'], default: 'crate', description: 'What it is.' },
    stack: { type: 'integer', default: -1, minimum: -1, description: 'Its stack in STACKS; −1: none.' },
    level: { type: 'integer', default: 0, minimum: 0, description: 'Its place in the stack, from 0 at the bottom.' },
  },
});

type Components = {
  platform: Mover;
  zone: Trigger & { name: string };
  prop: { body: number; kind: 'crate' | 'barrel'; stack: number; level: number };
};

/** The fixture's events, for listeners (`w.events.on('enter', …)`). */
export type PropEvents = {
  enter: { zone: string; body: number };
  leave: { zone: string; body: number };
  rescued: { body: number };
};

type PropWorld = World<Components>;

/** Movers set their velocities before the actors move (the phase `ai`). */
function platforms(w: PropWorld): void {
  for (const e of w.query('platform')) driveMover(physicsOf(w), e.platform, w);
}

/** After the step: each zone's comings and goings, then the rescue (the phase `readback`). */
function zones(w: PropWorld): void {
  for (const { zone } of w.query('zone')) {
    const { entered, left } = updateTrigger(physicsOf(w), zone);
    for (const body of entered) w.emit('enter', { zone: zone.name, body });
    for (const body of left) w.emit('leave', { zone: zone.name, body });
  }
}

/** Puts lost bodies back on the floor (the phase `readback`). */
function rescue(w: PropWorld): void {
  for (const body of rescueLost(physicsOf(w), ROOM)) w.emit('rescued', { body });
}

export default defineScene<Components>('physics-props', {
  description:
    'Props, movers, triggers and the rescue: the hero rides a platform, knock topples two stacks of crates, sink drops the barrel through the floor; roundtrip restores the physics world in place.',
  physics: true,
  setup(w) {
    const physics = physicsOf(w);
    addLevelBodies(physics, ROOM);
    const path = w.settings.get<boolean>('props.lift') ? LIFT : RIDE;
    const start = moverPose({ ...path, body: -1 }, 0).position;
    const ride = physics.addBody({
      type: 'kinematic',
      position: start,
      colliders: [{ shape: { type: 'box', size: [2, 0.4, 2] } }],
    });
    w.spawn({ platform: { ...path, body: ride } });
    const gate = addSensor(physics, { type: 'box', size: [2, 2, 2] }, { position: [9, 1, 3] });
    const pit = addSensor(physics, { type: 'box', size: [3.5, 2, 4] }, { position: [15.25, 1, 6.5] });
    w.spawn({ zone: { name: 'gate', body: gate } });
    w.spawn({ zone: { name: 'pit', body: pit } });
    STACKS.forEach(({ x, z, height }, stack) => {
      for (let level = 0; level < height; level++) {
        const body = addBox(physics, [CRATE, CRATE, CRATE], { position: [x, CRATE * (level + 0.5), z] });
        w.spawn({ prop: { body, kind: 'crate', stack, level } });
      }
    });
    const barrel = addCylinder(physics, 0.375, 0.875, { position: [BARREL[0], 0.4375, BARREL[1]] });
    w.spawn({ prop: { body: barrel, kind: 'barrel' } });
    w.systems.add('platforms', platforms, { phase: 'ai' });
    w.systems.add('zones', zones, { phase: 'readback' });
    w.systems.add('rescue', rescue, { phase: 'readback' });
    spawnActor(w, { at: [start.x, 0.4, start.z], character: createCharacter() });
  },
  step(w, intents) {
    if (!pressed(intents, 'knock')) return;
    const physics = physicsOf(w);
    for (const { prop } of w.query('prop')) {
      const { position } = physics.readBody(prop.body);
      if (Math.hypot(position.x - SWING[0], position.z - SWING[1]) > REACH) continue;
      knock(physics, prop.body, [SWING[0], 0, SWING[1]], { spin: w.rng('knock').range(-0.5, 0.5) });
    }
  },
  actions: {
    roundtrip(w) {
      const physics = physicsOf(w);
      const capture = physics.capture();
      physics.restore({ ...capture, snapshot: Array.from(capture.snapshot) });
    },
    sink(w) {
      const barrel = w.query('prop').find((e) => e.prop.kind === 'barrel')!;
      physicsOf(w).setBody(barrel.prop.body, { position: [BARREL[0], -2, BARREL[1]], velocity: [0, 0, 0] });
    },
  },
});
