/**
 * @file The Animation Lab (PLAN.md WP 10.8; my-3d2dge's animlab, `src/starter/60-animlab.js`): its scene, `lab:lineup`
 * (labs/anim/scenes/lineup.ts), the humanoid on every build and the mannequin in a row, all told one thing from one
 * clock. The panel: what the row plays (every state, pose, stance and move, each a link, so the address is what plays);
 * for a move, its phases on a timeline (wind-up, strike with its hit window, recovery) with a slider that scrubs it
 * (`lab.anim.time`) and the rates it plays at (`lab.anim.speed`); and the bones drawn over the figures
 * (labs/anim/overlay.ts, from `__engine.anim(id).joints`). The page registers the mannequin from the Quaternius set,
 * so the row ends with it (`lab.anim.mannequin`), and stands the camera in front of the row unless `?cam` says; for a
 * library clip (`lab.anim.play=clip:<set>/<clip>`, the Library Lab's retarget preview) it registers every set first.
 *
 * The same job without the page: `node x gallery move` (each move on the humanoid at its phases, on a contact sheet),
 * `node x sheet` (a body's states as a contact sheet) and `node x sim` on labs/anim/scenes/lineup.ts (`--set
 * lab.anim.play=move:jab`: the row headless; `__engine.anim(id)` in an `x inspect` session for each figure's joints).
 *
 * @example
 * // labs/anim/?lab.anim.play=move:jab&lab.anim.time=0.2
 * @see tests/e2e/labs.spec.ts
 */
/// <reference types="vite/client" />
import { createEngine, getMove, type EngineFrame } from '../../engine';
import quaternius from '../../data/anim/sets/quaternius/_set.json?raw';
import { loadLibrary, loadMannequin } from '../box/library';
import { button, el, entryList, labPanel } from '../index/lab';
import { drawBones } from './overlay';
import { LINEUP_STATES, lineup } from './scenes/lineup';

/** What the lab reads and sets through the engine's inspector (`__engine`). */
interface AnimInspector {
  set(path: string, value: unknown): unknown;
  entities(query: string): { id: number }[];
  anim(id: number): { joints: Record<string, number[]> };
  gallery: { list(kind: string): string[] };
  camera: { set(code: string): unknown };
}

const params = new URLSearchParams(location.search);
params.set('scene', lineup.id); // its one scene, whatever page imports it (as the physics and library labs do)
if (!params.has('lab.anim.mannequin')) params.set('lab.anim.mannequin', 'true');
const play = params.get('lab.anim.play') ?? 'idle';
// a library clip needs every set registered (and the mannequin with them); else the mannequin alone
if (play.startsWith('clip:')) await loadLibrary((await import('../box/clipFiles')).CLIP_FILES);
else loadMannequin(quaternius);

const panel = labPanel(document, {
  title: 'Animation Lab',
  what: 'The humanoid on every build and the mannequin, told one state, pose, stance or move from one clock.',
  command: 'node x gallery move · node x sheet · node x sim labs/anim/scenes/lineup',
});
const overlay = document.querySelector<HTMLCanvasElement>('#overlay'); // none in another page that imports this
let bones = params.get('bones') === '1';
let inspector: AnimInspector | null = null;
const onFrame = (frame: EngineFrame) => {
  if (!overlay) return;
  if (!bones || !inspector) return void overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  const live = inspector;
  drawBones(
    overlay,
    frame.camera,
    live.entities('labFigure').map((e) => live.anim(e.id).joints),
  );
};

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const engine = await createEngine({ canvas, scenes: [lineup.id], search: `?${params}`, onFrame });
inspector = engine.inspector as unknown as AnimInspector | null;
if (inspector) {
  const live = inspector;
  if (!params.has('cam') && !params.has('cam3')) live.camera.set('cam3=orbit,0,12,7.5,8,0.9,8');
  const link = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('lab.anim.play', value);
    next.delete('lab.anim.time');
    return { label: value, href: `?${next}`, current: value === play };
  };
  if (play.startsWith('move:')) timeline(panel.section('Timeline'), live, play);
  const shown = panel.section('Bones');
  const box = el(document, 'input', { type: 'checkbox', id: 'bones', ...(bones ? { checked: '' } : {}) }) as HTMLInputElement; // prettier-ignore
  box.addEventListener('change', () => (bones = box.checked));
  shown.append(el(document, 'label', {}, box, ' draw each figure’s bones'));
  entryList(panel.section('Moves'), live.gallery.list('move').map(link));
  entryList(panel.section('States, poses and stances'), LINEUP_STATES.map(link));
  panel.status(`playing ${play}`);
} else panel.status('the engine did not start: the page’s message says why');

/** The move's phases on a bar, a slider that scrubs it, and the rates it plays at (see the file comment). */
function timeline(parent: HTMLElement, live: AnimInspector, move: string) {
  const { time, hitAt } = getMove(move);
  const total = time.wind + time.active + time.recover;
  const bar = el(document, 'div', { class: 'lab-timeline', style: 'display:flex;height:14px;margin:4px 0' });
  for (const [name, seconds, colour] of [['wind', time.wind, '#4a6fa5'], ['active', time.active, '#c0504d'], ['recover', time.recover, '#6a8f4e']] as const) // prettier-ignore
    bar.append(el(document, 'span', { title: `${name} ${seconds.toFixed(3)} s`, 'data-phase': name, style: `flex:${seconds};background:${colour}` })); // prettier-ignore
  const hit = time.wind + hitAt * time.active;
  const scrub = el(document, 'input', { type: 'range', min: '0', max: total.toFixed(3), step: String(1 / 60), value: params.get('lab.anim.time') ?? '0', id: 'scrub', style: 'width:100%' }) as HTMLInputElement; // prettier-ignore
  const read = el(document, 'p', {}, `${total.toFixed(3)} s; the hit window opens at ${hit.toFixed(3)} s`);
  scrub.addEventListener('input', () => {
    live.set('lab.anim.time', Number(scrub.value));
    read.textContent = `held at ${Number(scrub.value).toFixed(3)} s of ${total.toFixed(3)} s`;
  });
  parent.append(bar, scrub, read);
  button(parent, 'Play', () => live.set('lab.anim.time', -1));
  for (const rate of [1, 0.5, 0.25]) button(parent, `×${rate}`, () => live.set('lab.anim.speed', rate));
}
