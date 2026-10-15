/**
 * @file The overlay page's module (tests/pages/overlay.html), the browser half of tests/e2e/overlay.spec.ts (PLAN.md
 * WP 6.5): the box room (labs/box/scenes/room.ts) as a recorded session with its view (engine/app/view.ts), drawn by
 * the engine's renderer (WebGPU) into a canvas that does not fill the page, with the HTML/CSS overlay
 * (engine/ui/overlay.ts) over it, updated after every frame with the camera the frame was drawn with.
 *
 * `window.__overlay`:
 * - `ui`, the overlay; `three`, three.js as the page loaded it; `view`, the run's view.
 * - `frame(dt)` draws a frame of the run as it stands and updates the overlay (`dt` seconds since the last).
 * - `camera(code)` switches the view's camera (a camera code, `cam=topdown`).
 * - `project(point)`: where three.js's `Vector3.project` puts a world point for the camera last drawn, in client CSS
 *   px, the overlay's yardstick.
 * - `movers()`: the room's movers as drawn, by id, m.
 * - `play(text, options)` plays a replay from step 0 in a new session, with the overlay following it: a label over
 *   each mover, a damage number on one mover every `hits` steps, HUD lines updated each step, the crosshair on; it
 *   draws a frame every `draw` steps and updates the overlay after every step. It returns the hashes at the replay's
 *   checkpoints and what the overlay showed.
 *
 * Invariants: `ready` turns true once the warm-up and the first frame are done, never after an error; frames are
 * drawn only when a test calls the page; the overlay only reads the run and the view.
 */
/// <reference types="vite/client" />
import * as THREE from 'three/webgpu';
import roomLevel from '../../labs/box/levels/room.txt?raw';
import '../../labs/box/scenes/room';
import { createPlayback } from '../../engine/app/playback';
import { createRunView } from '../../engine/app/view';
import { registry } from '../../engine/core/registry';
import { createMaterialLibrary } from '../../engine/gfx/materials/library';
import { createRenderer, type Gfx, type GfxError } from '../../engine/gfx/renderer';
import type { Replay } from '../../engine/sim/replay';
import { createSession } from '../../engine/sim/session';
import { createOverlay } from '../../engine/ui/overlay';
import { defineLevel } from '../../engine/world/level/level';

/** One structured error record, as `window.__engine.errors` holds them (PLAN.md §8.3). */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const signals = { ready: false, errors: [] as ErrorRecord[], info: () => ({ page: 'overlay' }) };
Object.assign(window, { __engine: signals });

/** Records the page's one error and shows it. */
function fail(record: ErrorRecord): void {
  signals.errors.push(record);
  if (message) {
    message.textContent = `${record.code}: ${record.message}\nFix: ${record.fix}`;
    message.hidden = false;
  }
  console.error(`[${record.code}] ${record.message}. Fix: ${record.fix}`);
}

if (!registry.has('level', 'level:room')) {
  defineLevel('level:room', { text: roomLevel, file: 'labs/box/levels/room.txt' }, registry);
}

/** Starts the renderer and the room, warms up, draws the first frame and publishes `__overlay`. */
async function start(): Promise<void> {
  let session = createSession('box:room');
  const view = createRunView({ run: () => session, registry, materials: createMaterialLibrary({ registry }) });
  let gfx: Gfx;
  try {
    gfx = await createRenderer(canvas);
  } catch (error) {
    const { code, message: text, fix } = error as GfxError;
    if (code && fix) return fail({ code, message: text, fix });
    throw error;
  }
  gfx.renderer.shadowMap.enabled = true;
  view.stage.register(gfx.warmup);
  const warm = async () => {
    for (const camera of view.cameras) await gfx.warmup.run({ scene: view.stage.scene, camera });
  };
  await warm();
  const ui = createOverlay({ canvas });
  const aspect = () => canvas.clientWidth / canvas.clientHeight;
  let draws = 0;

  /** Draws a frame of the run as it stands (waiting out a warm-up), then updates the overlay with its camera. */
  const frame = async (dt = 1 / 60) => {
    for (let tries = 0; ; tries++) {
      const report = gfx.frame(view.frame({ alpha: 1, dt, aspect: aspect() }));
      if (report.drawn) break;
      if (tries === 5) throw new Error('overlay page: no frame was drawn in 5 tries');
      await warm();
    }
    if (++draws % 8 === 0) await gfx.device.queue.onSubmittedWorkDone();
    ui.update(view.drawn, dt);
  };

  const page = {
    ui,
    three: THREE,
    view,
    frame,
    camera: (code: string) => view.setCamera(code).code,
    project(point: readonly number[]): [number, number] {
      const ndc = new THREE.Vector3(point[0], point[1], point[2]).project(view.drawn);
      const r = canvas.getBoundingClientRect();
      return [r.left + ((ndc.x + 1) / 2) * r.width, r.top + ((1 - ndc.y) / 2) * r.height];
    },
    movers: () =>
      Object.fromEntries([...view.stage.standIns].map(([id, mesh]) => [id, mesh.position.toArray() as number[]])),
    async play(text: string, options: { draw?: number; hits?: number } = {}) {
      const { draw = 10, hits = 15 } = options;
      const replay = JSON.parse(text) as Replay;
      const checkpoints = new Set(Object.keys(replay.hashes['linux-x64'] ?? {}).map(Number));
      session = createSession(replay.scene, { seed: replay.seed, settings: replay.settings });
      view.restarted();
      const playback = createPlayback(replay);
      const hashes: Record<string, string> = {};
      const labels = new Map<number, ReturnType<typeof ui.label>>();
      let numbers = 0;
      let shownMost = 0;
      ui.crosshair(true);
      if (checkpoints.has(0)) hashes['0'] = session.world.hash();
      while (!playback.done) {
        playback.step(session);
        view.stepped();
        const tick = playback.tick;
        for (const [id, mesh] of view.stage.standIns) {
          const p = mesh.position;
          if (!labels.has(id))
            labels.set(id, ui.label(`mover ${id}`, { at: () => [p.x, p.y + 0.7, p.z], id: `mover:${id}` }));
          if (tick % hits === 0 && (tick / hits) % view.stage.standIns.size === id - 1) {
            ui.damage(tick, { at: [p.x, p.y + 1, p.z] });
            numbers++;
          }
        }
        ui.hud('tick', `Tick ${tick}`);
        ui.hud('hint', 'Space: jump', { at: 'bottom', keys: true });
        if (tick % draw === 0) await frame(1 / 60);
        else {
          view.frame({ alpha: 1, dt: 1 / 60, aspect: aspect() });
          ui.update(view.drawn, 1 / 60);
        }
        shownMost = Math.max(shownMost, ui.state().elements.filter((e) => e.visible).length);
        if (checkpoints.has(tick)) hashes[String(tick)] = session.world.hash();
      }
      for (const label of labels.values()) label.remove();
      ui.hud('tick', null);
      ui.hud('hint', null);
      ui.crosshair(false);
      return { hashes, steps: playback.tick, numbers, labels: labels.size, shownMost };
    },
  };
  await frame(0);
  Object.assign(window, { __overlay: page });
  if (message) message.hidden = true;
  signals.ready = true;
}

start().catch((error: unknown) => {
  const code = (error as { code?: string }).code ?? 'OVERLAY_START';
  const fix = (error as { fix?: string }).fix ?? 'the console names the cause';
  fail({ code, message: String((error as Error).message ?? error), fix });
});
