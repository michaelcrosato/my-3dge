/**
 * @file Clip sets in the registry, and clip layers kept as plain data (PLAN.md §10.4, WP 8.9): the registry kind
 * `clipset`, one entry per set of readable clips (`clipset:quaternius`: the set's header and its clips), which the
 * reader registers, as levels and actions are (the engine imports nothing outside engine/: a page imports the files of
 * `data/anim/sets/<set>/` with `import.meta.glob`, a Node tool reads them, tools/anim/library.ts), so
 * `__engine.describe('clipset')` and `x describe clipset` list them; and `ClipLayerPool`, the clip layer (layer.ts) of
 * an entity, loaded from its plain data at every `get`, as `AnimatorPool` keeps animators (character.ts), so the sim
 * steps it and the view poses it from the same numbers.
 *
 * - `defineClipSet(set)` parses the set (validate.ts `parseClipSet`: a broken clip is refused with its `ANIM_CLIP_*`
 *   code) and registers it as `clipset:<set, lower case>`; the same set again returns the entry already there.
 *   `clipSetFromFiles(files)` joins a set directory's files into one set first (a page's import of the files);
 *   `getClipSet(id)` is one, `clipSetIds()` lists them; `defineSetBuild(id, setId)` registers the build a set's clips
 *   were captured on (`build:mannequin`).
 * - `ClipLayerPool.library(id)` loads a set for playing (library.ts `loadClipLibrary`) once per pool: the sim keeps a
 *   pool per world and the view its own, so a bake made while the sim steps (under its fdlibm maths) is never one the
 *   view made, and the reverse.
 * - `CLIPS_FIELDS` are the fields of an actor's component `clips` (engine/sim/actors.ts): the sets it plays from, its
 *   contact IK and blade, and the layer's state (`ClipLayerState`), which the sim's step changes and the hash covers.
 * - `legsHeld(layer)`: how much of the legs a layer's clips hold now, which the view's foot plant leaves them (WP 13.10).
 *
 * Invariants: an entry is the parsed set, frozen; clip names are the set's own, played as `SET/Clip` (or bare: the
 * first set's with that name, layer.ts). A pool's layer is made again only when its make (build, sets, IK, blade,
 * step) changes, and is loaded from the data at every `get`, so it keeps nothing of its own between calls.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * import { REST, standing } from '../../../tests/unit/anim/clip-fixtures';
 * const registry = createRegistry();
 * const set = { set: 'TEST', sources: { A: { rest: REST } }, clips: { Stand: { src: 'A', dur: 1, keys: [standing(0)] } } };
 * defineClipSet(set, { registry }).id; // 'clipset:test'
 * const pool = new ClipLayerPool(registry);
 * const data = { sets: ['clipset:test'], ik: true, blade: 0, state: emptyClipState() };
 * pool.get(1, data, 'build:heroic').play('Stand').save().slots[0].clip; // 'TEST/Stand'
 * @see engine/anim/clip/clipsets.test.ts
 */
import { registry as sharedRegistry, sameValue, type Registry } from '../../core/registry';
import { defineSchema } from '../../core/schema';
import { codeError } from '../../core/log';
import { MathUtils } from '../../core/math';
import { buildKind, defineBuild, getBuild, type Build } from '../builds';
import { boneMask, jointIndex } from '../skeleton';
import { ClipLayer, type ClipLayerState } from './layer';
import { loadClipLibrary, type ClipLibrary } from './library';
import { restBuild } from './rest';
import type { Clip } from './readable';
import { parseClip, parseClipSet, type ClipSet } from './validate';

/** A set directory's header file. */
const SET_FILE = '_set.json';

/** The fields of a `clipset` entry: a set's header (validate.ts `ClipSet`) and its clips. */
export const CLIPSET_FIELDS = defineSchema({
  set: {
    type: 'string',
    required: true,
    description: 'Its name, upper case (QUATERNIUS): its clips play as SET/Clip.',
  },
  title: { type: 'string', description: 'Its title, as shown.' },
  credit: {
    type: 'string',
    description: 'The credit its license asks for, shown on screen wherever its clips ship (data/anim/SOURCES.md).',
  },
  format: { type: 'integer', description: 'The readable format its clips are in: 1, or 2 (PLAN.md §10.2).' },
  legend: { type: 'array', description: 'How to read its clips, line by line (format 2).' },
  from: { type: 'array', description: 'The sets a picked set was taken from.' },
  fps: { type: 'number', unit: '1/s', description: 'The rate its captures were sampled at.' },
  sources: {
    type: 'object',
    description: 'The libraries its clips came from, by name: provenance, and the rest body each was measured on.',
  },
  body: { type: 'any', description: 'The mannequin’s segments and bands, or null (only the Quaternius set has them).' },
  fit: { type: 'object', description: 'Each clip’s mean and worst body-point error against its capture, mm.' },
  clips: {
    type: 'object',
    required: true,
    description: 'Its clips by name: readable key poses (engine/anim/clip/readable.ts), parsed.',
  },
});

/** A `clipset` entry: a parsed set, frozen. */
export type ClipSetEntry = Readonly<ClipSet> & { readonly id: string; readonly kind: 'clipset' };

/** Declares the kind `clipset` on `registry`, once. */
export function clipSetKind(registry: Registry): void {
  if (registry.kinds().includes('clipset')) return;
  registry.defineKind('clipset', {
    description:
      'A set of readable clips loaded for playing (PLAN.md §10): its header and its clips. The library is data/anim/sets/, one directory a set, which a page or tool reads and registers (defineClipSet).',
    fields: CLIPSET_FIELDS,
    defineWith:
      "defineClipSet({ set: 'NAME', sources: { … }, clips: { … } }) with a set's _set.json and its clip files",
  });
}
clipSetKind(sharedRegistry);

/** The id a set registers under: `clipset:` and its name in lower case (`clipset:style100_back`). */
export function clipSetId(name: string): string {
  return `clipset:${name.toLowerCase()}`;
}

/**
 * Parses `input` (a set's text or object, `parseClipSet`) and registers it on `registry` as `clipSetId(set)`; a set
 * registered already is returned when it is the same, and refused (`CORE_DUPLICATE_ID`) when it differs.
 */
export function defineClipSet(input: ClipSet | string | object, options: { registry?: Registry } = {}): ClipSetEntry {
  const registry = options.registry ?? sharedRegistry;
  clipSetKind(registry);
  const set = parseClipSet(input);
  const id = clipSetId(set.set);
  if (registry.has('clipset', id)) {
    const kept = registry.get('clipset', id) as unknown as ClipSetEntry;
    if (Object.entries(set).every(([key, value]) => sameValue(value, kept[key as keyof ClipSetEntry]))) return kept;
  }
  return registry.def('clipset', id, set as unknown as Record<string, unknown>) as unknown as ClipSetEntry;
}

/**
 * A set directory's files (`_set.json` and one `.json` file a clip, by file name; others ignored) as one set
 * (`parseClipSet`), its clips in its `fit`'s order, then by file name, as tools/anim/repack.ts `joinSet` gives it:
 * what a page registers from the text `import.meta.glob` loads. `where` names the directory in errors.
 */
export function clipSetFromFiles(files: Readonly<Record<string, string>>, where = 'the set'): ClipSet {
  const { [SET_FILE]: head, ...rest } = files;
  if (head === undefined) throw codeError('ANIM_CLIP_BAD_HEADER', { where, field: SET_FILE, value: 'missing', shape: 'the set’s header' }); // prettier-ignore
  let raw: object;
  try {
    raw = JSON.parse(head) as object;
  } catch (error) {
    throw codeError('ANIM_CLIP_NOT_JSON', { where: `${where}/${SET_FILE}`, problem: (error as Error).message }, error);
  }
  const header = parseClipSet({ ...raw, clips: {} });
  const clips = new Map<string, Clip>();
  const names = Object.keys(rest).filter((name) => name.endsWith('.json'));
  for (const file of names.sort()) {
    const clip = parseClip(rest[file], `${where}/${file}`);
    clips.set(clip.clip ?? file.replace(/\.json$/, ''), clip);
  }
  const fit = header.fit ?? {};
  const order = [...Object.keys(fit).filter((name) => clips.has(name)), ...[...clips.keys()].filter((name) => !Object.hasOwn(fit, name))]; // prettier-ignore
  return { ...header, clips: Object.fromEntries(order.map((name) => [name, clips.get(name)!])) };
}

/** The registered set `id` (`clipset:quaternius`); a missing one throws `CORE_NO_ENTRY`, naming the closest ids. */
export function getClipSet(id: string, registry: Registry = sharedRegistry): ClipSetEntry {
  clipSetKind(registry);
  return registry.get('clipset', id) as unknown as ClipSetEntry;
}

/** The ids of the sets registered on `registry`, sorted (`clipset:cmu`, `clipset:mesh2motion`…). */
export function clipSetIds(registry: Registry = sharedRegistry): string[] {
  clipSetKind(registry);
  return registry.list('clipset').map((entry) => entry.id);
}

/**
 * Registers build `id` with the proportions clip set `setId`'s clips were captured on (retarget.ts `restBuild` of its
 * first source's rest body, or `source`'s), once, and returns it: `build:mannequin` from `clipset:quaternius` is the
 * build engine/gfx/puppets/bodies/mannequin.ts draws, which the sim's animator needs before the view's body exists.
 */
export function defineSetBuild(
  id: string,
  setId: string,
  options: { source?: string; registry?: Registry } = {},
): Build {
  const registry = options.registry ?? sharedRegistry;
  buildKind(registry);
  if (registry.has('build', id)) return getBuild(id, registry);
  const { set, sources = {} } = getClipSet(setId, registry);
  const source = options.source ?? Object.keys(sources)[0];
  const rest = sources[source]?.rest;
  if (!rest) throw codeError('ANIM_NO_REST', { set, name: JSON.stringify(id), src: String(source) });
  return defineBuild(id, restBuild(rest), registry);
}

/** An empty clip layer's state: nothing plays. */
export function emptyClipState(): ClipLayerState {
  return { slots: [], moving: null, running: false, ground: 0, root: [0, 0] };
}

/** The fields of an actor's component `clips`: its clip layer as plain data (see the file comment). */
export const CLIPS_FIELDS = defineSchema({
  sets: {
    type: 'array',
    items: { type: 'string' },
    default: [],
    description: 'The clip sets it plays from, by id (clipset:quaternius); a bare clip name is the first set’s.',
  },
  ik: { type: 'boolean', default: true, description: 'Whether its clips plant the feet and lift the body (retarget).' },
  blade: {
    type: 'number',
    default: 0,
    minimum: 0,
    unit: 'm',
    description: 'A blade held in the right hand, kept above the floor; 0 for none.',
  },
  state: {
    type: 'object',
    default: emptyClipState(),
    description: 'The layer’s state (ClipLayerState): the clips playing, their times and weights, the root motion.',
  },
});

/** What `CLIPS_FIELDS` holds. */
export interface ClipsData {
  sets: string[];
  ik: boolean;
  blade: number;
  state: ClipLayerState;
}

/** The thighs, whose mask weight says how much of the legs a masked clip holds. */
const THIGHS = [jointIndex('thighL'), jointIndex('thighR')];

/**
 * How much of the legs `layer`'s clips hold now, 0 to 1: a full-body clip as its fade shows (smoothstepped), a masked
 * one by its mask's weight on the thighs, an added one none; an idle layer holds nothing.
 */
export function legsHeld(layer: ClipLayer): number {
  let free = 1;
  for (const slot of layer.state.slots) {
    if (slot.play.additive) continue;
    const mask = slot.play.mask ? boneMask(slot.play.mask).weights : null;
    free *= 1 - MathUtils.smoothstep(slot.w, 0, 1) * (mask ? Math.max(mask[THIGHS[0]], mask[THIGHS[1]]) : 1);
  }
  return 1 - free;
}

/** Clip layers by entity id, each loaded from its entity's `clips` data at every `get` (see the file comment). */
export class ClipLayerPool {
  readonly #registry: Registry;
  readonly #libraries = new Map<string, ClipLibrary>();
  readonly #byId = new Map<number, { make: string; layer: ClipLayer }>();

  constructor(registry: Registry = sharedRegistry) {
    this.#registry = registry;
  }

  /** The registered set `id`, loaded for playing once for this pool. Throws `CORE_NO_ENTRY` for a missing one. */
  library(id: string): ClipLibrary {
    let library = this.#libraries.get(id);
    if (!library) {
      const { id: _id, kind: _kind, ...set } = getClipSet(id, this.#registry);
      this.#libraries.set(id, (library = loadClipLibrary(set)));
    }
    return library;
  }

  /**
   * The clip layer of entity `id`, loaded with `data.state`, for `build` (the animator's) at the step `dt` (s); made
   * again when its make changes. Never writes `data`: `layer.save()` is the state to write back.
   */
  get(id: number, data: Readonly<ClipsData>, build: Build | string, dt?: number): ClipLayer {
    const made = typeof build === 'string' ? getBuild(build, this.#registry) : build;
    const make = `${made.id}|${data.sets.join(',')}|${data.ik}|${data.blade}|${dt ?? ''}`;
    let held = this.#byId.get(id);
    if (!held || held.make !== make) {
      const library = data.sets.map((set) => this.library(set));
      const layer = new ClipLayer({ library, build: made, dt, ik: data.ik, blade: data.blade });
      this.#byId.set(id, (held = { make, layer }));
    }
    return held.layer.load(data.state);
  }

  /** Forgets the layers of the entities `keep` turns down. */
  prune(keep: (id: number) => boolean): void {
    for (const id of this.#byId.keys()) if (!keep(id)) this.#byId.delete(id);
  }
}
