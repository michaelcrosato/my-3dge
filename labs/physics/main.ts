/**
 * @file The Physics Lab (PLAN.md WP 10.8; my-3d2dge's physics playground): the box's two physics scenes with their
 * settings at hand. `box:ragdoll` (labs/box/scenes/ragdoll.ts): partners knocked down by a blow every few seconds,
 * falling as ragdolls and getting up the way they lie; `box:hall-props` (labs/box/scenes/hall-props.ts): the hall's
 * crates and barrels by the hundred, which the hero walks into and shoves. The scene is `?scene=` (`ragdoll` by
 * default), each scene setting a link (`?box.ragdoll.push=8`, read when the scene starts, so a link reloads), and the
 * view's knobs buttons through the inspector: gravity (`physics.gravity`), the sim's speed (`time.scale`), pause,
 * step one tick and resume. The read-outs, each frame: the tick, the entities and the ragdolls, the state's hash.
 *
 * The same job without the page: `node x sim` on labs/box/scenes/ragdoll.ts or hall-props.ts (`--steps 360 --set
 * box.ragdoll.push=8`, `--set box.hallProps.count=300`) runs either headless and prints its hash; `__engine.set`, `pause`,
 * `step` and `entities` in an `x inspect` session do what the buttons do.
 *
 * @example
 * // labs/physics/?scene=hall-props&box.hallProps.count=300
 * @see tests/e2e/labs.spec.ts
 */
/// <reference types="vite/client" />
import { createEngine } from '../../engine';
import hallLevel from '../box/levels/hall.txt?raw';
import roomLevel from '../box/levels/room.txt?raw';
import { HALL_MATERIALS } from '../box/looks/hall-floor';
import { hallProps } from '../box/scenes/hall-props';
import { ragdoll } from '../box/scenes/ragdoll';
import { button, el, entryList, labPanel } from '../index/lab';

/** The lab's scenes, by the name `?scene` takes, each with the setting links that matter for it. */
const SCENES = {
  ragdoll: { id: ragdoll.id, links: ['box.ragdoll.push=2', 'box.ragdoll.push=8', 'box.ragdoll.handOff=false'] },
  'hall-props': { id: hallProps.id, links: ['box.hallProps.count=10', 'box.hallProps.count=300'] },
} as const;

/** What the lab reads and sets through the engine's inspector (`__engine`). */
interface PhysicsInspector {
  info(): { tick: number; scene: string };
  set(path: string, value: unknown): unknown;
  pause(): void;
  resume(): void;
  step(n?: number): number;
  hash(): string;
  entities(query?: string): { id: number }[];
}

const params = new URLSearchParams(location.search);
const name = (params.get('scene') ?? 'ragdoll') in SCENES ? (params.get('scene') ?? 'ragdoll') : 'ragdoll';
const scene = SCENES[name as keyof typeof SCENES];
params.set('scene', scene.id);
const panel = labPanel(document, {
  title: 'Physics Lab',
  what: "The box's physics scenes with their settings at hand: ragdolls falling and getting up, and the hall's props by the hundred.", // prettier-ignore
  command: 'node x sim labs/box/scenes/ragdoll · node x inspect',
});
const readout = el(document, 'pre', { class: 'lab-readout' });
let inspector: PhysicsInspector | null = null;
const onFrame = () => {
  if (!inspector) return;
  const { tick } = inspector.info();
  const [all, ragdolls] = [inspector.entities().length, inspector.entities('ragdoll').length];
  readout.textContent = `tick ${tick} · ${all} entities, ${ragdolls} ragdolls · hash ${inspector.hash()}`;
};
const levels = {
  'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' },
  'level:hall': { text: hallLevel, file: 'labs/box/levels/hall.txt', materials: HALL_MATERIALS },
};
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const engine = await createEngine({ canvas, scenes: [ragdoll.id, hallProps.id], levels, search: `?${params}`, onFrame }); // prettier-ignore
inspector = engine.inspector as unknown as PhysicsInspector | null;
if (inspector) {
  const live = inspector;
  const link = (scenes: string, extra = '') => `?scene=${scenes}${extra ? `&${extra}` : ''}`;
  entryList(panel.section('Scenes'), Object.keys(SCENES).map((key) => ({ label: key, href: link(key), current: key === name }))); // prettier-ignore
  entryList(panel.section('Settings (read when the scene starts)'), scene.links.map((setting) => ({ label: setting, href: link(name, setting), current: params.get(setting.split('=')[0]) === setting.split('=')[1] }))); // prettier-ignore
  const time = panel.section('Time');
  button(time, 'Pause', () => live.pause());
  button(time, 'Step', () => live.step(1));
  button(time, 'Resume', () => live.resume());
  for (const scale of [0.25, 1]) button(time, `×${scale}`, () => live.set('time.scale', scale));
  const gravity = panel.section('Gravity (m/s²)');
  for (const g of [1.62, 9.81, 30]) button(gravity, String(g), () => live.set('physics.gravity', g));
  panel.section('Read-outs').append(readout);
  panel.status(`playing ${scene.id}`);
} else panel.status('the engine did not start: the page’s message says why');
