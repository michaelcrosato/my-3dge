/**
 * @file The physics-40 fixture scene (PLAN.md WP 3.1, §6.5 item 9): 40 bodies falling into a walled pit, so Rapier's
 * part of the sim is proven against golden hashes in Node and in Chromium. Twenty crates stand in five stacks of four
 * and twenty balls are tossed in on top, so by step 200 bodies rest on bodies; a `push` intent throws every piece up
 * and away from the pit's centre. The pit is a compiled level (text, below) turned into level bodies.
 *
 * Its dev action `roundtrip` takes the physics world's capture and restores it in place from its text form (the
 * snapshot as a list of numbers). tests/replays/physics-40.replay.json runs it at step 200, with bodies in contact, and
 * its goldens are those of the run without it (fixtures/scenes/physics-40/index.test.ts), so `x replay --browser sim`
 * proves that a restore continues exactly in Node and in Chromium. The replay also raises `physics.gravity` mid-run, a
 * recorded setting change.
 *
 * Game code: it imports only engine/sim-api.ts. Each piece is an entity with a `piece` component naming its body; a
 * system in the `readback` phase copies the body's pose into it after the physics step.
 *
 * Tests: tests/replays/physics-40.replay.json (`node x replay tests/replays/physics-40.replay.json --browser sim`),
 * fixtures/scenes/physics-40/index.test.ts. Try it: `node x sim fixtures/scenes/physics-40 --steps 600`.
 */
import {
  addLevelBodies,
  compileLevel,
  defineComponent,
  defineScene,
  physicsOf,
  pressed,
  type World,
} from '../../../engine/sim-api';

/** The pit: 8 × 8 m, walled (3 m), 6 × 6 m inside. */
export const PIT = compileLevel(
  [
    '---',
    'description: The walled pit of the physics-40 fixture.',
    '---',
    '########',
    ...Array.from({ length: 6 }, () => '#......#'),
    '########',
  ].join('\n'),
  { file: 'physics-40.txt' },
);

/** The fixture's component: a piece of the pile, its body and its pose after the last step. */
export const PIECE = defineComponent('piece', {
  description: 'A body of the physics-40 pile and its pose, read back after each physics step.',
  fields: {
    body: { type: 'integer', default: 0, minimum: 0, description: 'The body id.' },
    x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
    y: { type: 'number', default: 0, unit: 'm', description: 'Up.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
    qx: { type: 'number', default: 0, description: 'Rotation, x.' },
    qy: { type: 'number', default: 0, description: 'Rotation, y.' },
    qz: { type: 'number', default: 0, description: 'Rotation, z.' },
    qw: { type: 'number', default: 1, description: 'Rotation, w.' },
  },
});

type Components = {
  piece: { body: number; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number };
};

/** The pit's centre (m). */
const CENTRE = [4, 4] as const;

/** Adds a piece: its body, and an entity that names it. */
function addPiece(w: World<Components>, body: number): void {
  w.spawn({ piece: { body } });
}

/** Copies each piece's body pose into its component (the `readback` phase). */
function readback(w: World<Components>): void {
  const physics = physicsOf(w);
  for (const e of w.query('piece')) {
    const { position, rotation } = physics.readBody(e.piece.body);
    Object.assign(e.piece, { x: position.x, y: position.y, z: position.z });
    Object.assign(e.piece, { qx: rotation.x, qy: rotation.y, qz: rotation.z, qw: rotation.w });
  }
}

export default defineScene<Components>('physics-40', {
  description:
    'Forty bodies (twenty stacked crates, twenty tossed balls) falling into a walled pit; push scatters them; roundtrip restores the physics world in place.',
  physics: true,
  setup(w) {
    const physics = physicsOf(w);
    addLevelBodies(physics, PIT);
    for (let stack = 0; stack < 5; stack++) {
      const turn = 0.05 * stack;
      for (let level = 0; level < 4; level++) {
        const crate = physics.addBody({
          position: [2 + stack, 0.3 + level * 0.6, 2.5 + 0.04 * level],
          rotation: [0, Math.sin(turn), 0, Math.cos(turn)],
          colliders: [{ shape: { type: 'box', size: [0.6, 0.6, 0.6] }, density: 300, friction: 0.6 }],
        });
        addPiece(w, crate);
      }
    }
    for (let i = 0; i < 20; i++) {
      const ball = physics.addBody({
        position: [1.9 + (i % 5) * 1.05, 3.5 + Math.floor(i / 5) * 0.7, 3.1 + (i % 3) * 0.5],
        velocity: [(i % 4) - 1.5, 0, -1],
        colliders: [{ shape: { type: 'ball', radius: 0.25 }, restitution: 0.3 }],
      });
      addPiece(w, ball);
    }
    w.systems.add('readback', readback, { phase: 'readback' });
    readback(w);
  },
  step(w, intents) {
    if (!pressed(intents, 'push')) return;
    const physics = physicsOf(w);
    for (const e of w.query('piece')) {
      const { position, mass } = physics.readBody(e.piece.body);
      const [dx, dz] = [position.x - CENTRE[0], position.z - CENTRE[1]];
      const length = Math.hypot(dx, dz) || 1;
      physics.applyImpulse(e.piece.body, [(mass * 3 * dx) / length, mass * 4, (mass * 3 * dz) / length]);
    }
  },
  actions: {
    roundtrip(w) {
      const physics = physicsOf(w);
      const capture = physics.capture();
      physics.restore({ ...capture, snapshot: Array.from(capture.snapshot) });
    },
  },
});
