/**
 * @file The CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), fetched on demand into `.cache/anim/`
 * (PLAN.md §5.3 and §10.3, WP 8.5): about 2,500 takes by 113 subjects, each subject a skeleton (`NN.asf`) and each
 * take a motion (`NN_MM.amc`) at 120 frames a second (some at 60). Ported from `my-3d2dge:tools/cmu.mjs:27-100`, with
 * takes read out of the site's 1.08 GB `allasfamc.zip` by HTTP ranges (tools/anim/zip.ts, after shardfall's
 * `crates/pav_tools/src/mocap/fetch.rs`) instead of downloading the archive. CMU's terms: `data/anim/SOURCES.md`.
 *
 * The `.cache/anim/` layout (git-ignored, never committed; `ANIM_CACHE`):
 * - `cmu/`: the takes and skeletons, flat (`02.asf`, `02_01.amc`), and `index.tsv` (the site's motion list: id,
 *   subject, the subject's description, the take's, its frame rate);
 * - `cmu-lib/`: every take converted, a set directory per subject (`x anim cmu library`, about 65 MB);
 * - `src/`: other libraries' source files (GLB, FBX, BVH) for `x anim import`, as their owners supply them.
 *
 * Invariants: what is in the cache is never fetched again. The site serves plain HTTP. A take the archive lacks
 * (subject 144, added after it) comes from its own URL.
 *
 * @example
 * parseMotionList('<TR><TD>Subject #2 (various expressions)</TD></TR>' +
 *   '<TR><TD>1</TD><TD><a href="/subjects/02/02_01.amc">amc</a></TD><TD>walk</TD><TD>120</TD></TR>');
 * // [{ id: '02_01', subject: 2, about: 'various expressions', desc: 'walk', fps: 120 }]
 * @see tools/anim/cmu.test.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../x';
import { fetchBytes, openZip, urlSource, type Zip, type ZipEntry } from './zip';

/** The cache's root, `.cache/anim/`. */
export const ANIM_CACHE = join(ROOT, '.cache', 'anim');
/** Where takes go: `.cache/anim/cmu/`. */
export const CMU_CACHE = join(ANIM_CACHE, 'cmu');
/** The site; it serves plain HTTP. */
export const SITE = 'http://mocap.cs.cmu.edu';
/** Every subject's skeleton and takes, 1.08 GB, read by ranges. */
export const ARCHIVE = `${SITE}/allasfamc.zip`;

/** A take on the site's motion list. */
export interface IndexedTake {
  id: string;
  subject: number;
  about: string;
  desc: string;
  fps: number;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const clean = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The takes on the site's full motion list (`search.php?subjectnumber=%&motion=%`), from its HTML. */
export function parseMotionList(html: string): IndexedTake[] {
  const rows: IndexedTake[] = [];
  let about = '';
  for (const tr of html.split(/<TR/i)) {
    const subject = /Subject #(\d+)\s*\(([^)]*)\)/i.exec(tr);
    if (subject) {
      about = clean(subject[2]);
      continue;
    }
    const amc = /\/subjects\/(\d+)\/(\d+_\d+)\.amc/i.exec(tr);
    if (!amc) continue;
    // the frame rate is the last number in the row (the trial's number comes first)
    const cells = [...tr.matchAll(/<TD[^>]*>(.*?)<\/TD>/gis)].map((m) => clean(m[1]));
    const fps = cells.filter((c) => /^\d+$/.test(c)).pop();
    rows.push({ id: amc[2], subject: +amc[1], about, desc: cells[2] ?? '', fps: +(fps ?? 120) });
  }
  return rows;
}

/** The site's motion list, from `index.tsv` in `dir` (fetched and written there once). */
export function cmuIndex(dir: string = CMU_CACHE): IndexedTake[] {
  const file = join(dir, 'index.tsv');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const rows = parseMotionList(latin1(fetchBytes(`${SITE}/search.php?subjectnumber=%25&motion=%25`)));
    const lines = rows.map((t) => [t.id, t.subject, t.about, t.desc, t.fps].join('\t'));
    writeFileSync(file, `id\tsubject\tabout\tdesc\tfps\n${lines.join('\n')}\n`);
  }
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [id = '', subject = '', about = '', desc = '', fps = ''] = line.split('\t');
      return { id, subject: +subject, about, desc, fps: +fps };
    });
}

/** The archive, its directory read (two small requests); entries are read only when asked for. */
export const cmuArchive = (): Zip => openZip(urlSource(ARCHIVE));

/** A take's or skeleton's file name: `02_01.amc`, `02.asf`. */
const baseName = (entryName: string) => entryName.slice(entryName.lastIndexOf('/') + 1);

/** The cached paths of takes `ids` (`02_01`), each with its subject's skeleton, fetching what is missing. */
export function cmuGet(
  ids: string[],
  dir: string = CMU_CACHE,
  archive: () => Zip = cmuArchive,
): { id: string; asf: string; amc: string }[] {
  for (const id of ids) if (!/^\d+_\d+$/.test(id)) throw new Error(`a take is SUBJECT_TRIAL, like 02_01: ${id}`);
  mkdirSync(dir, { recursive: true });
  const files = ids.flatMap((id) => [`${id.split('_')[0]}.asf`, `${id}.amc`]);
  const missing = [...new Set(files)].filter((file) => !existsSync(join(dir, file)));
  if (missing.length) {
    const zip = archive();
    const byName = new Map(zip.entries.map((e) => [baseName(e.name), e]));
    const inArchive = missing.filter((file) => byName.has(file));
    const bytes = zip.readMany(inArchive.map((file) => byName.get(file) as ZipEntry));
    inArchive.forEach((file, i) => writeFileSync(join(dir, file), bytes[i]));
    for (const file of missing.filter((f) => !byName.has(f))) {
      writeFileSync(join(dir, file), fetchBytes(`${SITE}/subjects/${file.split(/[_.]/)[0]}/${file}`));
    }
  }
  return ids.map((id) => ({ id, asf: join(dir, `${id.split('_')[0]}.asf`), amc: join(dir, `${id}.amc`) }));
}

/** Every take: the archive's, read in a few dozen ranged requests, and the motion list's that it lacks. */
export function cmuAll(dir: string = CMU_CACHE, archive: () => Zip = cmuArchive): number {
  const zip = archive();
  const have = new Set(existsSync(dir) ? readdirSync(dir) : []);
  const wanted = zip.entries.filter(
    (e) => /^\d+(_\d+)?\.(asf|amc)$/.test(baseName(e.name)) && !have.has(baseName(e.name)),
  );
  const bytes = zip.readMany(wanted);
  wanted.forEach((e, i) => writeFileSync(join(dir, baseName(e.name)), bytes[i]));
  const now = new Set(readdirSync(dir));
  const lacking = cmuIndex(dir).filter((t) => !now.has(`${t.id}.amc`));
  cmuGet(
    lacking.map((t) => t.id),
    dir,
    () => zip,
  );
  return readdirSync(dir).filter((f) => f.endsWith('.amc')).length;
}

/** The skeleton file of subject `s` in `dir`: `02.asf`. */
export const asfOf = (s: number | string, dir: string = CMU_CACHE) => join(dir, `${String(s).padStart(2, '0')}.asf`);
