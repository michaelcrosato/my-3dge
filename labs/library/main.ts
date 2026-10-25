/**
 * @file The Library Lab (PLAN.md WP 10.8; the Mocap Lab's UX, `my-3d2dge:src/mocap.game.js`): the animation library
 * on the box's clip mode (labs/box/scenes/clips.ts), the mannequin and the hero playing the clip the address names
 * (`?box.clips.clip=cmu/Cartwheel`; Quaternius' dance by default). The panel: the catalog searched (every word in a
 * clip's name, tags or description; each hit a link, so the address is what plays); the clip as text (`clipText`)
 * with Apply (the text played as a set of its own, `lab<n>/<clip>`, the scene started again with its seed), Reset (the
 * library's clip again), Mirror (the text's mirror image, `mirrorClip`) and Copy (the text to the clipboard, for a
 * model to read); frame stepping (`box.clips.frame`, a frame of its bake at 30 a second, held; Play plays on); and the
 * clip retargeted to every build, a link to the Animation Lab's row (`lab.anim.play=clip:<set>/<clip>`).
 * Every set under data/anim/sets/ registers first (labs/box/library.ts, as the box page does for clip mode).
 *
 * The same job without the page: `node x anim find <words>` searches the catalog, `node x anim show <set>/<clip>`
 * prints its text, `node x anim bake <set>/<clip>` bakes it, and `node x sim` on labs/box/scenes/clips.ts (`--set
 * box.clips.clip=<set>/<clip>`) plays it headless; `__engine.set('box.clips.frame', 12)` steps it in `x inspect`.
 *
 * @example
 * // labs/library/?box.clips.clip=cmu/Cartwheel&box.clips.frame=12
 * @see tests/e2e/labs.spec.ts
 */
/// <reference types="vite/client" />
import { clipSetIds, clipText, createEngine, getClipSet, mirrorClip, parseClip } from '../../engine';
import roomLevel from '../box/levels/room.txt?raw';
import { loadLibrary, registerEdit } from '../box/library';
import { clips } from '../box/scenes/clips';
import { button, el, entryList, labPanel } from '../index/lab';

/** What the lab reads and sets through the engine's inspector (`__engine`). */
interface LibraryInspector {
  set(path: string, value: unknown): unknown;
  seed(n?: number): number;
}

/** How many hits the search lists. */
const HITS = 25;

await loadLibrary(import.meta.glob<string>('../../data/anim/sets/*/*.json', { query: '?raw', import: 'default' }));
const params = new URLSearchParams(location.search);
params.set('scene', clips.id);
const asked = params.get('box.clips.clip') ?? 'quaternius/Dance_Loop';
/** Every clip of the library, as `<set>/<clip>` with the words a search reads. */
const catalog = clipSetIds().flatMap((id) => {
  const set = getClipSet(id);
  const dir = id.replace(/^clipset:/, '');
  return Object.entries(set.clips).map(([name, clip]) => ({
    name: `${dir}/${name}`,
    words: `${name} ${(clip.tags ?? []).join(' ')} ${clip.desc ?? ''}`.toLowerCase(),
  }));
});
const [askedSet, askedClip] = asked.split(/\/(.*)/s);
const original = getClipSet(`clipset:${askedSet}`).clips[askedClip];

const panel = labPanel(document, {
  title: 'Library Lab',
  what: 'The clip library: search it, play a clip on the mannequin and the hero, read and edit its text, mirror it, step its frames.', // prettier-ignore
  command: 'node x anim find · node x anim show · node x anim bake',
});
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const levels = { 'level:room': { text: roomLevel, file: 'labs/box/levels/room.txt' } };
const engine = await createEngine({ canvas, scenes: [clips.id], levels, search: `?${params}` });
const inspector = engine.inspector as unknown as LibraryInspector | null;
if (inspector) {
  const live = inspector;
  const link = (name: string) => {
    const next = new URLSearchParams(params);
    next.delete('scene');
    next.set('box.clips.clip', name);
    next.delete('box.clips.frame');
    return { label: name, href: `?${next}`, current: name === asked };
  };
  // the search
  const search = panel.section('Search');
  const query = el(document, 'input', { type: 'search', id: 'search', placeholder: 'words: dance, sword attack…' }) as HTMLInputElement; // prettier-ignore
  const hits = el(document, 'div', { id: 'hits' });
  const find = () => {
    const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = catalog.filter((entry) => words.every((word) => entry.words.includes(word))).slice(0, HITS);
    hits.replaceChildren();
    entryList(
      hits,
      found.map((entry) => link(entry.name)),
    );
  };
  query.addEventListener('input', find);
  search.append(query, hits);
  // the clip as text
  const text = panel.section('The clip as text');
  const area = el(document, 'textarea', { id: 'clip-text', rows: '12', spellcheck: 'false' }) as HTMLTextAreaElement;
  area.value = original ? clipText(original) : `no clip ${asked}: search for one`;
  text.append(area);
  let applied = 0;
  button(text, 'Apply', () => {
    try {
      const played = registerEdit(`LAB${++applied}`, `clipset:${askedSet}`, askedClip, area.value);
      live.set('box.clips.clip', played);
      live.seed(live.seed()); // the scene again, its sets read anew
      panel.status(`playing your edit, ${played}`);
    } catch (error) {
      panel.status(String((error as Error).message));
    }
  });
  button(text, 'Reset', () => {
    if (original) area.value = clipText(original);
    live.set('box.clips.clip', asked);
    panel.status(`playing ${asked}`);
  });
  button(text, 'Mirror', () => {
    try {
      area.value = clipText(mirrorClip(parseClip(area.value, askedClip)));
    } catch (error) {
      panel.status(String((error as Error).message));
    }
  });
  button(text, 'Copy', () => void navigator.clipboard?.writeText(area.value));
  // the frames
  const frames = panel.section('Frames (30 a second)');
  let frame = Number(params.get('box.clips.frame') ?? -1);
  const shown = el(document, 'span', { id: 'frame' }, frame < 0 ? 'playing' : `frame ${frame}`);
  const go = (next: number) => {
    frame = next;
    live.set('box.clips.frame', frame);
    shown.textContent = frame < 0 ? 'playing' : `frame ${frame}`;
  };
  button(frames, '◀', () => go(Math.max(0, frame - 1)));
  button(frames, '▶', () => go(Math.max(0, frame + 1)));
  button(frames, 'Play', () => go(-1));
  frames.append(shown);
  entryList(panel.section('On every build'), [{ label: `${asked} on the Animation Lab's row`, href: `../anim/?lab.anim.play=clip:${encodeURIComponent(asked)}` }]); // prettier-ignore
  entryList(panel.section('From each set'), clipSetIds().map((id) => link(`${id.replace(/^clipset:/, '')}/${Object.keys(getClipSet(id).clips)[0]}`))); // prettier-ignore
  panel.status(original ? `playing ${asked}` : `no clip ${asked} in the library: search for one`);
} else panel.status('the engine did not start: the page’s message says why');
