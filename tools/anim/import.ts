/**
 * @file The importer (PLAN.md §5.3 and §10, WP 8.5): skeletal animation libraries turned into a set of readable
 * clips. Its inputs are `.glb` files (a humanoid rig, a mesh and its clips: tools/anim/glb-library.ts) or, with `cmu`,
 * stretches of CMU takes that the catalog picks (tools/anim/cmu-capture.ts); a catalog written by hand gives each
 * clip its words and says where each library came from. Each library's body is measured from its own clips
 * (engine/anim/clip/encode.ts `measure`), and each clip is fitted with as few key poses as keep it within `tol` mm of
 * the capture (`fitClip`). Ported from `my-3d2dge:tools/anim-import.mjs:38-72, 233-263`.
 *
 * Two modes:
 * - **format 2, the default**: CMU frames in-betweened, not the nearest; the set says `format: 2`; each clip records
 *   its source's rate (`fps`) and `via: "source"`; each loop its `speed`, as shardfall's importer computes it
 *   (`crates/pav_tools/src/mocap/mod.rs:308-316`): round(stride / H0 × 100 / dur), left out below 10, the stride
 *   being the root's travel over one cycle; and with a root-motion twin per library (`rm`, Quaternius' `_RM` files,
 *   `mod.rs:326-366`), each in-place loop takes its twin's travel as its stride, and each one-shot whose twin travels
 *   more than 50 mm is added as `<clip>_RM`; every key with its hands, grips and feet's roll, a clip whose spine
 *   shares miss its capture by more than `SPINE_MISS` with the spine override too where it brings the clip's worst
 *   frame closer (engine/anim/clip/hands.ts, feet.ts, spine.ts), and each clip's contacts and events, detected
 *   (tools/anim/contacts.ts);
 * - **`legacy`**: nearest-frame sampling and format 1, exactly as the source's importer, so `x anim import --cmu
 *   --legacy` writes the CMU set byte for byte.
 *
 * The catalog: `{ clip: [tags, what the body does, orig?] }`; the tags `loop` and `once` set whether a clip loops (for
 * libraries whose names do not say: `_Loop`, `Idle`); `"$sources": { ID: { label, origin, license, url } }` records
 * each library (CMU's `CMU` record serves every subject, `CMU_NN`); `"$skip": { clip: why }` leaves clips out, the
 * reason logged; and, for CMU, `"$pick": { clip: [take, from?, to?, minCycle?] }` (seconds; no stretch: the one the
 * ledger's `active` column gives; a loop is cut at its best cycle, `minCycle` its shortest). Clips are named once: a
 * later library's clip with a taken name is left out, as is any whose name starts with `_` (a rest pose).
 *
 * @example
 * import { riggedGlb } from './glb-fixture';
 * const { set } = importSet({ glbs: [{ file: 'lib.glb', bytes: riggedGlb() }], name: 'TEST', legacy: true });
 * Object.keys(set.clips); // ['Wave_Loop']
 * set.sources.lib.rig; // 'unreal'
 * @see tools/anim/import.test.ts
 */
import { basename } from 'node:path';
import { fitClip, measure, type Capture, type EncodeExtra, type Fitted } from '../../engine/anim/clip/encode';
import { SPINE_MISS, spineMiss } from '../../engine/anim/clip/spine';
import type { Clip } from '../../engine/anim/clip/readable';
import type { ClipSet, ClipSource, RestBody } from '../../engine/anim/clip/validate';
import { cmuGet, cmuIndex, CMU_CACHE, type IndexedTake } from './cmu';
import { detectContacts } from './contacts';
import { readCmu, type Pick as TakePick } from './cmu-capture';
import { readGlbLibrary, type GlbLibrary } from './glb-library';
import { readLedger, type Ledger } from './ledger';
import { CMU_CREDIT } from './repack';

/** A catalog: each clip's `[tags, desc, orig?]`, plus `$sources`, `$skip` and (CMU) `$pick`. */
export type Catalog = Record<string, unknown> & {
  $sources?: Record<string, Record<string, string>>;
  $skip?: Record<string, string>;
  $pick?: Record<string, [string, number?, number?, number?]>;
};

/** What to import and how (see the file comment). */
export interface ImportOptions {
  /** `.glb` libraries, in order, each with its bytes and, optionally, its root-motion twin's. */
  glbs?: { file: string; bytes: Uint8Array; rm?: Uint8Array }[];
  /** Import the catalog's CMU picks instead. */
  cmu?: boolean;
  catalog?: Catalog;
  name?: string;
  title?: string;
  credit?: string;
  /** Each library's source id (default: its file name; CMU: `CMU_NN`). */
  sources?: string[];
  /** Each library's rest-pose clip (default: a T-pose or rest clip, else the first). */
  rest?: string[];
  tol?: number;
  fps?: number;
  /** Only these clips. */
  clips?: string[];
  /** The clips that hold a blade (default /Sword/). */
  blade?: RegExp;
  legacy?: boolean;
  /** The CMU cache, index and ledger (defaults: `.cache/anim/cmu/`, the site's list, `data/anim/cmu/`). */
  cmuDir?: string;
  index?: IndexedTake[];
  ledger?: Ledger;
}

/** A library ready to fit: its file, rig, clips and mannequin look. */
type Library = Pick<GlbLibrary, 'rig' | 'body'> & {
  file: string;
  clips: Record<string, Capture & { sourceFps?: number }>;
};

const QUATERNIUS_CREDIT =
  'Universal Animation Library 1 and 2 by Quaternius (quaternius.com), CC0 1.0 (public domain).';
const REST_CLIPS = ['A_TPose', 'T-Pose', 'TPose', 'Rest Pose', 'Rest_Pose', '_rest'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The root's travel from a capture's first frame to its last, mm (0 when it stays put). */
function travelOf(cap: Capture): number {
  const m = cap.move;
  if (!m) return 0;
  const n = m.length / 2;
  return Math.hypot(m[2 * n - 2] - m[0], m[2 * n - 1] - m[1]);
}

/** A library read from a `.glb`, its clips lent their root-motion twin's travel (see the file comment). */
function glbLibrary(glb: NonNullable<ImportOptions['glbs']>[number], fps: number, notes: string[]): Library {
  const lib = readGlbLibrary(glb.bytes, basename(glb.file), fps);
  notes.push(...lib.notes);
  if (glb.rm) {
    const twin = readGlbLibrary(glb.rm, `${basename(glb.file)} (root motion)`, fps);
    let [speeds, added] = [0, 0];
    for (const [name, tc] of Object.entries(twin.clips)) {
      const main = lib.clips[name];
      if (!main) continue;
      const d = travelOf(tc);
      if (main.loop && d > 0) [main.stride, speeds] = [d, speeds + 1];
      else if (!main.loop && d > 50) [lib.clips[`${name}_RM`], added] = [{ ...tc, name: `${name}_RM` }, added + 1];
    }
    notes.push(
      `${basename(glb.file)}: ${speeds} loops take their speed from its twin, ${added} clips that travel added as _RM`,
    );
  }
  return { file: glb.file, rig: lib.rig, clips: lib.clips, body: lib.body };
}

/** The CMU libraries the catalog's picks need, one per subject, and their source records (see the file comment). */
function cmuLibraries(
  options: ImportOptions,
  catalog: Catalog,
  about: Record<string, Record<string, string>>,
  notes: string[],
) {
  const picks = catalog.$pick ?? {};
  if (!Object.keys(picks).length) throw new Error('--cmu needs the catalog\'s "$pick": { clip: [take, from, to] }');
  const index = options.index ?? cmuIndex(options.cmuDir);
  const byId = new Map(index.map((t) => [t.id, t]));
  const ledger = options.ledger ?? readLedger();
  const rows = new Map(ledger.takes.map((t) => [t.id, t]));
  const [bySubject, subjectOf, order] = [new Map<string, TakePick[]>(), new Map<string, number>(), [] as string[]];
  // every take the picks need, fetched at once: one read of the archive's directory, near neighbours in one request
  const files = new Map(
    cmuGet([...new Set(Object.values(picks).map(([take]) => take))], options.cmuDir ?? CMU_CACHE).map((f) => [f.id, f]),
  );
  for (const [name, [take, from0, to0, minCycle]] of Object.entries(picks)) {
    const file = files.get(take) as { asf: string; amc: string };
    const [t, row] = [byId.get(take), rows.get(take)];
    const act = row && /^[\d.]+-[\d.]+$/.test(row.active) ? row.active.split('-').map(Number) : null;
    if (!t && !row) notes.push(`${take} is not in the CMU index or the ledger`);
    const [from, to] = from0 === undefined && act ? act : [from0, to0];
    if (!bySubject.has(file.asf)) {
      bySubject.set(file.asf, []);
      order.push(file.asf);
    }
    subjectOf.set(file.asf, subjectOf.get(file.asf) ?? (t ? t.subject : +take.split('_')[0]));
    const words = (catalog[name] as string[] | undefined)?.[0] ?? '';
    const fps = t ? t.fps : row ? +row.fps : 120;
    bySubject.get(file.asf)?.push({ name, take, from, to, minCycle, fps, loop: words.split(' ').includes('loop') });
  }
  const ids = order.map((asf) => `CMU_${pad2(subjectOf.get(asf) as number)}`);
  // one record per subject, from the catalog's "$sources".CMU: its label and page name the subject
  if (about.CMU) {
    for (const asf of order) {
      const n = subjectOf.get(asf) as number;
      const who = index.find((t) => t.subject === n)?.about ?? ledger.subjects.find((s) => s.subject === n)?.about;
      const label = `${about.CMU.label}, subject ${n}${who ? ` (${who})` : ''}`;
      about[`CMU_${pad2(n)}`] = { ...about.CMU, label, url: `http://mocap.cs.cmu.edu/search.php?subjectnumber=${n}` };
    }
  }
  const libraries = order.map((asf): Library => {
    const clips = readCmu(asf, bySubject.get(asf) ?? [], { fps: options.fps ?? 30, legacy: options.legacy, notes });
    for (const pk of bySubject.get(asf) ?? [])
      if (clips[pk.name]) clips[pk.name] = { ...clips[pk.name], sourceFps: pk.fps } as Capture;
    return { file: asf, rig: 'cmu', clips, body: null };
  });
  return { libraries, ids };
}

/** Imports a set (see the file comment); `notes` says what was left out, warned of or measured. */
export function importSet(options: ImportOptions): { set: ClipSet; notes: string[] } {
  const { tol = 30, fps = 30, legacy = false, blade = /Sword/ } = options;
  const notes: string[] = [];
  const catalog: Catalog = { ...(options.catalog ?? {}) };
  const about = { ...(catalog.$sources ?? {}) };
  const skip = catalog.$skip ?? {};
  delete catalog.$sources;
  delete catalog.$skip;
  const cmu = options.cmu ? cmuLibraries(options, catalog, about, notes) : null;
  delete catalog.$pick;
  const libraries = cmu?.libraries ?? (options.glbs ?? []).map((glb) => glbLibrary(glb, fps, notes));
  const sourceIds = options.sources?.length ? options.sources : (cmu?.ids ?? []);
  const only = options.clips ? new Set(options.clips) : null;
  const name = options.name ?? (options.cmu ? 'CMU' : 'QUATERNIUS');
  const title = options.title ?? (options.cmu ? 'CMU' : undefined);
  const credit = options.credit ?? (options.cmu ? CMU_CREDIT : QUATERNIUS_CREDIT);
  const set: ClipSet = {
    set: name,
    ...(title ? { title } : {}),
    format: legacy ? 1 : 2,
    credit,
    fps,
    sources: {},
    body: null,
    fit: {},
    clips: {},
  };
  const catalogued = Object.keys(catalog).length > 0;
  libraries.forEach((L, li) => {
    const restClip = [options.rest?.[li], ...REST_CLIPS].find((n) => n && L.clips[n]);
    const id = sourceIds[li] || basename(L.file).replace(/\.glb$/i, '');
    // as a set file stores it: JSON has no −0, which the rounding leaves on some measurements
    const rest = JSON.parse(JSON.stringify(measure(L.clips, restClip))) as RestBody;
    if (catalogued && !about[id])
      notes.push(`no "$sources" entry for ${id}: the set will not say where its clips came from`);
    (set.sources as Record<string, ClipSource>)[id] = {
      file: basename(L.file),
      rig: L.rig,
      ...(about[id] ?? {}),
      rest,
    };
    if (!set.body && L.body) set.body = L.body;
    let kept = 0;
    for (const [clipName, cap] of Object.entries(L.clips)) {
      if (set.clips[clipName] || (only && !only.has(clipName)) || clipName.startsWith('_')) continue;
      if (skip[clipName]) {
        notes.push(`left out ${clipName}: ${skip[clipName]}`);
        continue;
      }
      const entry = catalog[clipName] as [string, string, string?] | undefined;
      const extra: { blade: boolean; tags?: string[]; desc?: string } = { blade: blade.test(clipName) };
      if (entry) {
        const tags = entry[0].split(' ').filter(Boolean);
        if (tags.includes('loop')) cap.loop = true;
        if (tags.includes('once')) cap.loop = false;
        Object.assign(extra, { tags: tags.filter((t) => t !== 'loop' && t !== 'once'), desc: entry[1] });
      } else if (catalogued) notes.push(`no catalog entry for ${clipName}`);
      const { clip, max, mean } = legacy ? fitClip(rest, cap, tol, extra) : fitFormat2(rest, cap, tol, extra);
      const found = legacy ? null : detectContacts(cap, rest, clip, extra.tags);
      set.clips[clipName] = ordered(clip, id, cap, entry?.[2], legacy ? null : rest.H0, found);
      (set.fit as Record<string, [number, number]>)[clipName] = [Math.round(mean), Math.round(max)];
      kept++;
    }
    notes.push(
      `${basename(L.file)}: ${L.rig} rig, ${kept} clips; spine shares ${rest.spineW.join(' ')}, neck ${rest.neckW}`,
    );
  });
  return { set, notes };
}

/**
 * A capture fitted in format 2: hands, grips and foot roll on every key, and the spine override where the shares miss
 * the capture by more than `SPINE_MISS` and it brings the worst frame closer (it can bare a long neck's own miss:
 * CMU's). The survey fits the CMU ledger's takes the same way.
 */
export function fitFormat2(rest: RestBody, cap: Capture, tol: number, extra: EncodeExtra = {}): Fitted {
  const fitted = fitClip(rest, cap, tol, { ...extra, hands: true, feet: true });
  if (spineMiss(rest, cap) <= SPINE_MISS) return fitted;
  const over = fitClip(rest, cap, tol, { ...extra, hands: true, feet: true, spine: true });
  return over.max < fitted.max ? over : fitted;
}

/** A fitted clip's header in the set's order; with `H0` (format 2) its speed, source rate, `via` and contacts too. */
function ordered(
  clip: Clip,
  src: string,
  cap: Capture & { sourceFps?: number },
  orig: string | undefined,
  H0: number | null,
  found: Pick<Clip, 'events' | 'contacts'> | null = null,
): Clip {
  const out: Omit<Clip, 'keys'> = {
    clip: clip.clip,
    src,
    ...(cap.take ? { take: cap.take } : {}),
    ...(orig ? { orig } : {}),
    dur: clip.dur,
    loop: clip.loop,
  };
  const speed =
    H0 && cap.loop && clip.dur > 0 && cap.stride !== undefined ? Math.round(((cap.stride / H0) * 100) / clip.dur) : 0;
  if (speed >= 10) out.speed = speed;
  if (clip.tags) out.tags = clip.tags;
  if (clip.desc) out.desc = clip.desc;
  if (H0 && cap.sourceFps) out.fps = cap.sourceFps;
  if (H0) out.via = 'source';
  if (found?.events?.length) out.events = found.events;
  if (found?.contacts?.length) out.contacts = found.contacts;
  return { ...out, keys: clip.keys };
}
