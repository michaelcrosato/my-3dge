/**
 * @file The CMU survey (PLAN.md §5.3, WP 8.5): every downloaded take converted the way the importer would (whole
 * takes, 30 frames a second, fitted within 30 mm, in format 2 unless `legacy`: tools/anim/import.ts `fitFormat2`) and
 * measured into its ledger row (tools/anim/ledger.ts): its fit, the stretch where it moves, how far it travels, how
 * high and low the hips go, and its flags (upside down, feet off the floor, loose, short, an assumed rate, and `f2`
 * for a fit in format 2, which rows surveyed before WP 8.8 lack). With `library`, every take also becomes a set, one
 * directory a subject, in `.cache/anim/cmu-lib/` (fitted looser, within 50 mm, for browsing). Ported from `my-3d2dge:tools/cmu.mjs:147-232`
 * with its measurements kept (`legacy` reads the takes as the source does; tools/anim/cmu-capture.ts).
 *
 * What it keeps: each row's `note` (people's), and a verified rate: a take missing from the site's motion list
 * keeps its row's `fps` when its flags carry the evidence (`fps:c3d`, `twin:<id>`; data/anim/cmu/README.md), and
 * else is read at its subject's one rate, or 120, flagged `fps?`. What it brings up to date: every row's category
 * (its own description's) and `used` (the CMU catalog's picks), even for takes it did not convert.
 *
 * Invariants: fitting costs the square of a clip's length, so a take over 20 s is fitted in 10 s pieces; the
 * ledger's fit is over all of them, and the library keeps the pieces as `<take>_part<k>`.
 *
 * @example
 * // node x anim cmu survey --subjects 2 (downloads subject 2's takes first: node x anim cmu get 02_01 …)
 * flagsOf({ inverted: 3, off: 0, n: 100, dur: 0.5, mean: 12 }); // ['inverted', 'short']
 * @see tools/anim/survey.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fitClip, measure, type Capture } from '../../engine/anim/clip/encode';
import { POSE_POINTS } from '../../engine/anim/clip/readable';
import type { ClipSet } from '../../engine/anim/clip/validate';
import { ROOT } from '../x';
import { ANIM_CACHE, asfOf, CMU_CACHE, cmuIndex, type IndexedTake } from './cmu';
import { readCmu, type CmuCapture, type Pick } from './cmu-capture';
import { categoryOf, readLedger, writeLedger, type Ledger, type Take } from './ledger';
import { fitFormat2 } from './import';
import { CMU_CREDIT, splitSet, writeSetDir } from './repack';

/** The converted library's directory, `.cache/anim/cmu-lib/`. */
export const LIBRARY_DIR = join(ANIM_CACHE, 'cmu-lib');
/** The CMU catalog, whose `$pick` names the take each clip of the CMU set was cut from. */
export const CMU_CATALOG = join(ROOT, 'data', 'anim', 'catalogs', 'cmu.json');

/** What the survey does: which subjects, legacy reading, the ledger and library tolerances, and where things go. */
export interface SurveyOptions {
  subjects?: number[];
  legacy?: boolean;
  ledger?: boolean;
  library?: boolean;
  tol?: number;
  libraryTol?: number;
  dir?: string;
  ledgerDir?: string;
  libraryDir?: string;
  index?: IndexedTake[];
  progress?: (line: string) => void;
}

/** Which clips of the CMU set each take feeds: `{ '13_17': ['Boxing_Guard_Loop', 'Boxing_Jab'] }`. */
export function usedBy(catalog: string = CMU_CATALOG): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!existsSync(catalog)) return out;
  const picks = (JSON.parse(readFileSync(catalog, 'utf8')) as { $pick?: Record<string, [string]> }).$pick ?? {};
  for (const [clip, [take]] of Object.entries(picks)) (out[take] ??= []).push(clip);
  return out;
}

/** The flags a take's measurements earn: upside down (over 2 frames), feet off the floor (60%), short, loose. */
export function flagsOf(m: { inverted: number; off: number; n: number; dur: number; mean?: number }): string[] {
  const flags: string[] = [];
  if (m.inverted > 2) flags.push('inverted');
  if (m.off > m.n * 0.6) flags.push('floats');
  if (m.dur < 1) flags.push('short');
  if (m.mean !== undefined && m.mean > 30) flags.push('loose');
  return flags;
}

/** The evidence flags of a verified rate, kept through a survey. */
const RATE_EVIDENCE = /^(fps:c3d|twin:\d+_\d+)$/;

/** Surveys the downloaded takes (see the file comment); returns how many it converted and the seconds of motion. */
export function surveyCmu(options: SurveyOptions = {}): { done: number; secs: number; ledger: Ledger } {
  const { dir = CMU_CACHE, tol = 30, libraryTol = 50, legacy = false, progress = () => {} } = options;
  const index = options.index ?? cmuIndex(dir);
  const byId = new Map(index.map((t) => [t.id, t]));
  const ledger = readLedger(options.ledgerDir);
  const rows = new Map(ledger.takes.map((t) => [t.id, t]));
  const used = usedBy();
  const subjFps = new Map<number, Set<number>>();
  for (const t of index) subjFps.set(t.subject, (subjFps.get(t.subject) ?? new Set()).add(t.fps));
  const about = new Map(index.map((t) => [t.subject, t.about]));
  const amcs = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((f) => /^\d+_\d+\.amc$/.test(f))
    .map((f) => f.slice(0, -4));
  const bySubject = new Map<number, string[]>();
  for (const id of amcs) bySubject.set(+id.split('_')[0], [...(bySubject.get(+id.split('_')[0]) ?? []), id]);
  const blank = (t: IndexedTake): Take => ({
    ...{ id: t.id, subject: String(t.subject), fps: String(t.fps), sec: '', active: '', fit: '', travel: '', hips: '' },
    ...{ flags: 'not downloaded', used: '', note: '', desc: t.desc, category: categoryOf(t.desc, ledger.categories) },
  });
  for (const t of index) if (!bySubject.get(t.subject)?.includes(t.id) && !rows.has(t.id)) rows.set(t.id, blank(t));
  let [done, secs] = [0, 0];
  for (const s of [...bySubject.keys()].sort((a, b) => a - b)) {
    if (options.subjects && !options.subjects.includes(s)) continue;
    const ids = (bySubject.get(s) ?? []).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const verified = (id: string) =>
      rows
        .get(id)
        ?.flags.split(' ')
        .some((f) => RATE_EVIDENCE.test(f));
    const only = subjFps.get(s)?.size === 1 ? [...(subjFps.get(s) as Set<number>)][0] : 120;
    const fpsOf = (id: string) => byId.get(id)?.fps ?? (verified(id) ? +(rows.get(id)?.fps ?? 120) : only);
    const picks: Pick[] = ids.map((id) => ({ name: id, take: id, fps: fpsOf(id) }));
    const [L, failed] = readSubject(asfOf(s, dir), picks, legacy);
    const rest = L._rest ? measure(L, '_rest') : null;
    const feet = ['toeL', 'toeR', 'ballL', 'ballR', 'ankleL', 'ankleR'].map((p) => POSE_POINTS.indexOf(p));
    const floor = L._rest ? Math.min(...feet.slice(0, 4).map((i) => L._rest.data[i * 3 + 2])) : 0;
    const set: ClipSet | null = options.library && rest ? librarySet(s, about.get(s) ?? '', rest) : null;
    for (const id of ids) {
      const t = byId.get(id);
      const old = rows.get(id);
      const kept = old?.flags.split(' ').filter((f) => RATE_EVIDENCE.test(f)) ?? [];
      const row: Take = {
        ...(old ?? blank({ id, subject: s, about: '', desc: '', fps: fpsOf(id) })),
        fps: String(fpsOf(id)),
      };
      if (t) Object.assign(row, { desc: t.desc });
      const flags = t ? [] : kept.length ? kept : ['fps?'];
      const cap = L[id];
      if (!cap || !rest) {
        rows.set(id, { ...row, flags: [`error: ${failed[id] ?? 'not read'}`, ...flags].join(' ') });
        continue;
      }
      const m = measureTake(cap, rest.H0, floor);
      const fitted = fitPieces(
        cap,
        rest,
        tol,
        legacy,
        options.ledger !== false,
        set,
        libraryTol,
        t?.desc ?? '',
        categoryOf(row.desc, ledger.categories),
      );
      const mean = fitted.sum / cap.n;
      const fit = options.ledger !== false ? `${Math.round(mean)}/${Math.round(fitted.worst)}` : (old?.fit ?? '');
      const all = [
        ...flags,
        ...flagsOf({ ...m, n: cap.n, dur: cap.dur, mean: options.ledger !== false ? mean : undefined }),
        ...(options.ledger !== false && !legacy ? ['f2'] : []), // the fit is format 2's (WP 8.8)
      ];
      rows.set(id, {
        ...row,
        sec: cap.dur.toFixed(1),
        active: m.active,
        travel: m.travel,
        hips: m.hips,
        fit,
        flags: all.join(' '),
      });
      [done, secs] = [done + 1, secs + cap.dur];
    }
    if (set) writeSetDir(join(options.libraryDir ?? LIBRARY_DIR, `cmu_${String(s).padStart(2, '0')}`), splitSet(set));
    progress(`subject ${s}: ${ids.length} takes (${done} so far, ${(secs / 3600).toFixed(1)} h of motion)`);
  }
  // every row follows the words and the catalog, so every row is brought up to date
  for (const row of rows.values()) {
    if (row.sec !== '') row.category = categoryOf(row.desc, ledger.categories);
    row.used = (used[row.id] ?? []).join(' ');
  }
  const next: Ledger = { ...ledger, takes: [...rows.values()] };
  for (const [s, text] of about) {
    const entry = next.subjects.find((x) => x.subject === s);
    if (!entry) next.subjects.push({ subject: s, takes: 0, about: text });
    else if (text) entry.about = text;
  }
  if (options.ledger !== false) writeLedger(next, options.ledgerDir);
  return { done, secs, ledger: next };
}

/** A subject's takes, read together, else one by one to find the bad one (its error kept). */
function readSubject(
  asf: string,
  picks: Pick[],
  legacy: boolean,
): [Record<string, CmuCapture>, Record<string, string>] {
  const failed: Record<string, string> = {};
  try {
    return [readCmu(asf, picks, { legacy }), failed];
  } catch {
    const caps: Record<string, CmuCapture> = {};
    for (const pk of picks) {
      try {
        Object.assign(caps, readCmu(asf, [pk], { legacy }));
      } catch (error) {
        failed[pk.take] = (error as Error).message;
      }
    }
    return [caps, failed];
  }
}

/** Where a take moves, how far it travels, how low and high its hips go, and how often it is upside down or aloft. */
function measureTake(cap: Capture, standing: number, floor: number) {
  const [P, n, d] = [POSE_POINTS.length, cap.n, cap.data];
  const F = P * 3;
  const [PEL, TOP] = [POSE_POINTS.indexOf('pelvis'), POSE_POINTS.indexOf('headTop')];
  const FEET = ['toeL', 'toeR', 'ballL', 'ballR', 'ankleL', 'ankleR'].map((p) => POSE_POINTS.indexOf(p));
  // where it moves: each frame's change (every point, plus the root's travel); the still ends are trimmed
  const e = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    let a = 0;
    for (let k = 0; k < F; k++) {
      const v = d[f * F + k] - d[(f - 1) * F + k];
      a += v * v;
    }
    const mv = cap.move;
    if (mv) a += P * ((mv[f * 2] - mv[f * 2 - 2]) ** 2 + (mv[f * 2 + 1] - mv[f * 2 - 1]) ** 2);
    e[f] = Math.sqrt(a / P);
  }
  const sorted = Array.from(e).sort((a, b) => a - b);
  const cut = Math.max(2, sorted[Math.floor(n * 0.9)] * 0.2);
  let a0 = 1;
  while (a0 < n - 1 && e[a0] < cut) a0++;
  let a1 = n - 1;
  while (a1 > a0 && e[a1] < cut) a1--;
  const active = `${Math.max(0, (a0 - 6) / 30).toFixed(1)}-${Math.min(cap.dur, (a1 + 6) / 30).toFixed(1)}`;
  let travel = 0;
  const mv = cap.move;
  if (mv) for (let f = 1; f < n; f++) travel += Math.hypot(mv[f * 2] - mv[f * 2 - 2], mv[f * 2 + 1] - mv[f * 2 - 1]);
  let [lo, hi, inverted, off] = [Infinity, -Infinity, 0, 0];
  for (let f = 0; f < n; f++) {
    const hz = d[f * F + PEL * 3 + 2];
    [lo, hi] = [Math.min(lo, hz), Math.max(hi, hz)];
    if (d[f * F + TOP * 3 + 2] < hz - 50) inverted++;
    if (Math.min(...FEET.map((i) => d[f * F + i * 3 + 2])) > floor + 150) off++;
  }
  const hips = `${Math.round((lo / standing) * 100)}-${Math.round((hi / standing) * 100)}`;
  return { active, travel: (travel / 1000).toFixed(1), hips, inverted, off };
}

/** Fits a take in pieces of at most 10 s (a take over 20 s), into the ledger's sums and, with a set, its clips. */
function fitPieces(
  cap: Capture,
  rest: ReturnType<typeof measure>,
  tol: number,
  legacy: boolean,
  ledger: boolean,
  set: ClipSet | null,
  libraryTol: number,
  desc: string,
  category: string,
) {
  const [n, F] = [cap.n, POSE_POINTS.length * 3];
  const W = n > 600 ? 300 : n - 1;
  let [sum, worst, part] = [0, 0, 0];
  for (let a = 0; a < n - 1 || a === 0; a += W) {
    const b = Math.min(n - 1, a + W);
    const piece: Capture = {
      ...{ name: cap.name, n: b - a + 1, dur: (b - a) / 30, loop: false, fps: 30 },
      ...{ data: cap.data.subarray(a * F, (b + 1) * F), move: cap.move ? cap.move.subarray(a * 2, (b + 1) * 2) : null },
    };
    const fitted = ledger ? (legacy ? fitClip(rest, piece, tol) : fitFormat2(rest, piece, tol)) : null;
    if (fitted) [sum, worst] = [sum + fitted.mean * piece.n, Math.max(worst, fitted.max)];
    if (set) {
      const { clip, max, mean } = fitted && libraryTol === tol ? fitted : fitClip(rest, piece, libraryTol);
      const name = W < n - 1 ? `${cap.name}_part${++part}` : cap.name;
      const take = `${cap.name} ${(a / 30).toFixed(2)}-${(b / 30).toFixed(2)}`;
      const words = { tags: [category], ...(desc ? { desc } : {}) };
      set.clips[name] = { clip: name, src: set.set, take, dur: clip.dur, loop: false, ...words, keys: clip.keys };
      (set.fit ??= {})[name] = [Math.round(mean), Math.round(max)];
    }
    if (b >= n - 1) break;
  }
  return { sum, worst };
}

/** A subject's set in the converted library: its source's rest body and record, and no clips yet. */
function librarySet(s: number, about: string, rest: ReturnType<typeof measure>): ClipSet {
  const id = `CMU_${String(s).padStart(2, '0')}`;
  const source = {
    ...{
      file: `${String(s).padStart(2, '0')}.asf`,
      rig: 'cmu',
      label: `CMU motion capture, subject ${s}${about ? ` (${about})` : ''}`,
    },
    ...{
      origin: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu)',
      license: 'CMU terms (data/anim/SOURCES.md)',
    },
    ...{ url: `http://mocap.cs.cmu.edu/search.php?subjectnumber=${s}`, rest },
  };
  return {
    set: id,
    title: `CMU subject ${s}`,
    format: 1,
    credit: CMU_CREDIT,
    fps: 30,
    sources: { [id]: source },
    body: null,
    fit: {},
    clips: {},
  };
}
