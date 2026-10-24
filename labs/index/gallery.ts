/**
 * @file A gallery lab (PLAN.md WP 10.8): a lab page over the gallery (engine/dev/gallery.ts) for some of its kinds.
 * The page registers what the repository defines, as the gallery's page does (tests/pages/gallery.ts: every lab's
 * scenes, looks and bodies, and the mannequin from the Quaternius set), starts the engine on the entry its hash names
 * (`#gallery/<kind>/<id>`; the first kind's first entry without one), and lists each kind's entries in the panel, each
 * a deep link; the entry showing is printed as `x describe` prints it. A new hash reloads the page, so the address is
 * always what shows.
 *
 * The same job without the page: `node x gallery <kind>` films every entry onto a contact sheet, and `node x describe
 * <kind> <id>` prints one. Each lab built on this names its own in its file comment.
 *
 * @example
 * // labs/props/main.ts, in its page:
 * // await galleryLab(document, window, { title: 'Props Lab', what: '…', command: 'node x gallery prop', kinds: ['prop'] });
 * @see tests/e2e/labs.spec.ts
 */
import { createEngine, defineMannequin } from '../../engine';
import quaternius from '../../data/anim/sets/quaternius/_set.json?raw';
import { el, entryList, labPanel, reloadOnHash, type LabSpec } from './lab';

import.meta.glob(['../*/{scenes,looks,bodies}/*.ts', '!../**/*.test.ts'], { eager: true });
defineMannequin(JSON.parse(quaternius) as Parameters<typeof defineMannequin>[0]);

/** What a lab reads through the engine's inspector (`__engine`): the gallery's lists and `describe`. */
export interface GalleryInspector {
  gallery: { list(kind: string): string[] };
  describe(kind: string, id: string): unknown;
}

/** The kind and entry a gallery hash names: `#gallery/prop/prop:crate` → ['prop', 'prop:crate']. */
export function hashEntry(hash: string): [kind: string, id: string] {
  const [, kind = '', ...rest] = decodeURIComponent(hash.replace(/^#/, '')).split('/');
  return [kind, rest.join('/')];
}

/** Starts the engine in `doc`'s `#view` on the gallery entry `hash` names, everything registered (see the file comment). */
export function galleryBoot(doc: Document, hash: string) {
  const canvas = doc.querySelector<HTMLCanvasElement>('#view')!;
  return createEngine({ canvas, scenes: [], hash });
}

/** Starts a gallery lab for `spec.kinds` in `doc` (see the file comment); resolves once its panel is filled. */
export async function galleryLab(doc: Document, win: Window, spec: LabSpec & { kinds: readonly string[] }) {
  const panel = labPanel(doc, spec);
  reloadOnHash(win);
  const [asked, askedId] = hashEntry(win.location.hash);
  const kind = spec.kinds.includes(asked) ? asked : spec.kinds[0];
  const hash = `#gallery/${kind}${kind === asked && askedId ? `/${askedId}` : ''}`;
  const engine = await galleryBoot(doc, hash);
  const inspector = engine.inspector as unknown as GalleryInspector | null;
  if (!inspector) return panel.status('the engine did not start: the page’s message says why');
  const lists = Object.fromEntries(spec.kinds.map((k) => [k, inspector.gallery.list(k)]));
  const shown = kind === asked && lists[kind].includes(askedId) ? askedId : lists[kind][0];
  panel.section('Describe').append(el(doc, 'pre', {}, JSON.stringify(inspector.describe(kind, shown), null, 1)));
  for (const k of spec.kinds) {
    const entries = lists[k].map((id) => ({
      label: id,
      href: `#gallery/${k}/${id}`,
      current: k === kind && id === shown,
    }));
    entryList(panel.section(`${k} (${lists[k].length})`), entries);
  }
  panel.status(`showing ${shown}`);
}
