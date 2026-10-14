/**
 * @file The box's stages for the CPU-only gameplay contract (tests/e2e/parity.spec.ts, PLAN.md §6.7, I-07): each
 * stage's scene, the component its gameplay entities hold, its replays (read from tests/replays/), the ones swept
 * through every camera and with the GPU features off, whether it plays through the looks, and the live play recorded
 * in its page. T2's rendering page plays only the replays named here: a box scene's replay that belongs to a stage
 * joins its entry (labs/box/README.md, "Adding a scene or a variant"). Data only. Split from parity.spec.ts to keep
 * each under 400 lines (ADR-0014 amendment 16).
 *
 * Invariants: `live` runs inside `evaluate`, in the page, ticking its virtual clock from the first frame; it may use
 * only the page's globals (`window.__clock`, `__engine`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, (...args: unknown[]) => unknown> & {
  input: Record<string, (...a: unknown[]) => unknown>;
  camera: Record<string, (...a: unknown[]) => unknown>;
};

/** A replay file's name and text. */
export const replay = (name: string): { name: string; text: string } => ({
  name,
  text: readFileSync(join(ROOT, `tests/replays/${name}.replay.json`), 'utf8'),
});

/** A box stage's scene and its replays, and live play to record in it (inside `evaluate`, ticking the virtual clock). */
export interface Stage {
  stage: string;
  scene: string;
  /** The component its gameplay entities hold. */
  component: string;
  replays: { name: string; text: string }[];
  /** The replays, by name, the camera-switching and GPU-features-off tests play: all of `replays` when absent. */
  swept?: { cameras: string[]; featuresOff: string[] };
  /** Whether its replays are also played through a look of each material style (see the file comment). */
  looks?: boolean;
  /** Plays live in the page through the devices and `__engine`, from the first frame. */
  live: () => void;
}

/** The stages and what each proves the contract with. */
export const STAGES: Stage[] = [
  {
    stage: 'Box 1',
    scene: 'room',
    component: 'pathMover',
    replays: ['box-1-room', 'box-1-tuned'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1); // the clock's origin
      __engine.input.axis('move', [0, 1]);
      tick(45);
      __engine.set('box.room.speed', '2.5');
      __engine.input.hold('jump');
      tick(30);
      __engine.camera.set('cam=topdown');
      __engine.input.hold('jump', false);
      __engine.input.axis('move', null);
      tick(50);
    },
  },
  {
    stage: 'Box 2',
    scene: 'room-hero',
    component: 'actor',
    replays: ['box-2-walk', 'box-2-dash', 'box-2-jump'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [1, 0.3]);
      tick(30);
      __engine.input.press('dash');
      tick(20);
      __engine.camera.set('cam3=chase');
      __engine.input.axis('move', [0, 1]);
      tick(25);
      __engine.input.hold('jump');
      tick(15);
      __engine.camera.set('cam3=first');
      __engine.input.hold('jump', false);
      tick(20);
      __engine.input.axis('move', [-1, 0]);
      __engine.camera.set('cam=side');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 3',
    scene: 'hall',
    component: 'actor',
    replays: ['box-3-climb', 'box-3-dais'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-0.8, 0.6]);
      tick(40); // off the dais, down its slope
      __engine.camera.set('cam3=chase');
      __engine.input.press('dash');
      tick(20);
      __engine.input.axis('move', [0, -1]);
      __engine.input.hold('jump');
      tick(15);
      __engine.camera.set('cam3=first');
      __engine.input.hold('jump', false);
      tick(25);
      __engine.input.axis('move', [1, 0]);
      __engine.camera.set('cam=iso');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 3, props',
    scene: 'hall-props',
    component: 'actor',
    replays: ['box-3-knock'].map(replay),
    looks: true,
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-1, 0]);
      tick(110); // off the dais, into the crate west of it, pushing it
      __engine.input.axis('move', null);
      __engine.camera.set('cam3=chase');
      tick(10);
      __engine.input.press('attack');
      tick(40);
      __engine.input.axis('move', [0.7, 0.7]);
      __engine.camera.set('cam3=first');
      tick(30);
      __engine.input.press('attack');
      __engine.input.axis('move', null);
      tick(30);
    },
  },
  {
    stage: 'Box 4',
    scene: 'crowd-100',
    component: 'actor',
    replays: ['box-4-chase', 'box-4-hop'].map(replay),
    swept: { cameras: ['box-4-chase'], featuresOff: ['box-4-hop'] },
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [-0.8, -0.6]);
      tick(50); // off the dais, the crowd entering round him
      __engine.camera.set('cam3=chase');
      tick(30);
      __engine.input.press('dash');
      __engine.camera.set('cam3=orbit');
      tick(20);
      __engine.input.axis('move', [1, 0]);
      __engine.camera.set('cam=topdown');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'Box 5',
    scene: 'fight',
    component: 'actor',
    replays: ['box-5-fight'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.input.axis('move', [0.8, 0.6]);
      tick(40); // off the dais, the fight joining round him
      __engine.input.press('attack');
      tick(12);
      __engine.input.press('attack');
      tick(12);
      __engine.camera.set('cam3=chase');
      __engine.input.press('attack');
      tick(25);
      __engine.input.press('skill');
      tick(15);
      __engine.input.press('dash');
      tick(4);
      __engine.input.press('attack');
      __engine.camera.set('cam3=orbit');
      tick(30);
      __engine.input.axis('move', null);
      tick(20);
    },
  },
  {
    stage: 'clip mode',
    scene: 'clips',
    component: 'actor',
    replays: ['box-8-clips'].map(replay),
    live: () => {
      const tick = (frames: number) => window.__clock.tick(frames);
      tick(1);
      __engine.set('box.clips.mask', 'upper');
      __engine.input.axis('move', [0, 1]);
      tick(30); // south, dancing above the waist
      __engine.set('box.clips.clip', 'quaternius/Sword_Attack');
      __engine.camera.set('cam3=chase');
      tick(30);
      __engine.input.axis('move', [1, 0]);
      __engine.set('box.clips.frame', 12);
      tick(20); // frame 12 held as he walks east
      __engine.set('box.clips.frame', -1);
      __engine.camera.set('cam3=orbit');
      tick(30);
      __engine.input.axis('move', null);
      __engine.set('box.clips.mask', 'full');
      __engine.set('box.clips.clip', 'cmu/Cartwheel');
      tick(40);
    },
  },
];
