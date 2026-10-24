/**
 * @file The re-import from the sources (PLAN.md §10.5 step 9, WP 8.8; ADR-0010 amendment 7): a set imported again from
 * its originals in format 2 (hands, grips, foot roll, the spine override, contacts, events), then swapped in one clip
 * at a time where the new clip keeps parity with the one it replaces, marked `via: "source"`; the others stay as they
 * were, each with its reason, in `data/anim/upgrade.json`.
 *
 * Parity, per clip (both decoded on their own source's rest body at 30 fps; ADR-0010 amendment 7): the two decodes lie
 * within the sum of their fits of each other, mean and worst (two decodes of one capture, each within its fit of it,
 * can lie no farther apart: the same motion), and the new clip fits its capture no worse than the old, mean and worst.
 * The plan's first rule, the new decode within the old clip's fit of the old decode, sits on its own boundary: a
 * format-2 clip that holds its capture closely lies from the old decode by just the old clip's error, which is its fit.
 *
 * Invariants: the re-import must measure every source's rest body exactly as the set holds it (the clips kept decode
 * on it); the set keeps its header, its order, its kept clips' bytes and every clip's words (tags and description),
 * and becomes format 2.
 *
 * @example
 * import { clipOf, REST, standing } from '../../tests/unit/anim/clip-fixtures';
 * const clip = { ...clipOf([standing(0), standing(1)], { dur: 1 }), src: 'S' };
 * const held = { set: 'T', sources: { S: { rest: REST } }, fit: { Stand: [5, 20] }, clips: { Stand: clip } };
 * const fresh = { ...held, fit: { Stand: [3, 12] }, clips: { Stand: { ...clip, via: 'source' } } };
 * upgradeSet(held, fresh).verdicts[0].swapped; // true: the same motion, fitting its capture no worse
 * @see tools/anim/upgrade.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { samplePose, type Clip } from '../../engine/anim/clip/readable';
import { poseError, poseMeanError, type ClipSet, type RestBody } from '../../engine/anim/clip/validate';
import { fetchMesh2Motion, MESH2MOTION_CACHE, SET_SOURCES } from './fetch';
import { importSet, type Catalog } from './import';
import { readSet } from './repack';

/** The clips each re-imported set kept, and why: `{ set: { swapped, of, kept: { clip: why } } }`. */
export const UPGRADE_FILE = 'data/anim/upgrade.json';

/** One set's line in `UPGRADE_FILE`. */
export interface Upgraded {
  swapped: number;
  of: number;
  kept: Record<string, string>;
}

/** What happened to one clip: swapped or kept, why, and the numbers (mm) that decided it. */
export interface Verdict {
  clip: string;
  swapped: boolean;
  why: string;
  /** How far apart the two decodes lie: mean and worst. */
  apart: [number, number];
  /** The old clip's fit and the new one's. */
  was: [number, number];
  now: [number, number];
}

/** How far apart (mm) two clips decode, mean and worst, at 30 fps over the shorter. */
export function apartOf(a: Clip, ra: RestBody, b: Clip, rb: RestBody): [number, number] {
  const n = Math.max(1, Math.floor(Math.min(a.dur, b.dur) * 30) + 1);
  let [sum, worst] = [0, 0];
  for (let f = 0; f < n; f++) {
    const [pa, pb] = [samplePose(ra, a, f / 30), samplePose(rb, b, f / 30)];
    sum += poseMeanError(pa, pb);
    worst = Math.max(worst, poseError(pa, pb));
  }
  return [+(sum / n).toFixed(1), +worst.toFixed(1)];
}

/** The verdict on swapping `fresh` in for `held` (see the file comment). */
export function judge(name: string, held: ClipSet, fresh: ClipSet): Verdict {
  const [a, b] = [held.clips[name], fresh.clips[name]];
  const was = (held.fit as Record<string, [number, number]>)[name];
  if (!b) return { clip: name, swapped: false, why: 'the re-import has no clip of this name', apart: [0, 0], was, now: was }; // prettier-ignore
  const now = (fresh.fit as Record<string, [number, number]>)[name];
  const rest = (set: ClipSet, clip: Clip) => set.sources![clip.src!].rest;
  const apart = apartOf(a, rest(held, a), b, rest(fresh, b));
  const verdict = { clip: name, apart, was, now };
  if (apart[0] > was[0] + now[0] || apart[1] > was[1] + now[1])
    return { ...verdict, swapped: false, why: `it decodes ${apart.join('/')} mm from the clip it would replace, past the fits' sum: another motion` }; // prettier-ignore
  if (now[0] > was[0] || now[1] > was[1])
    return { ...verdict, swapped: false, why: `it fits its capture worse in format 2: ${was.join('/')} → ${now.join('/')} mm (mean/worst)` }; // prettier-ignore
  return { ...verdict, swapped: true, why: 'parity' };
}

/**
 * `held` with `fresh`'s clips swapped in where they keep parity (see the file comment): the set, now format 2, and a
 * verdict per clip in the set's order. Throws when the re-import measured a source's rest body differently.
 */
export function upgradeSet(held: ClipSet, fresh: ClipSet): { set: ClipSet; verdicts: Verdict[] } {
  for (const [id, source] of Object.entries(held.sources ?? {})) {
    const again = fresh.sources?.[id];
    if (!again || JSON.stringify(again.rest) !== JSON.stringify(source.rest))
      throw new Error(`the re-import measured source ${id}'s rest body differently: the clips kept would decode differently; re-import from the same files`); // prettier-ignore
  }
  const verdicts = Object.keys(held.clips).map((name) => judge(name, held, fresh));
  const clips: Record<string, Clip> = {};
  const fit: Record<string, [number, number]> = {};
  for (const v of verdicts) {
    // a swapped clip keeps the set's words for it (its tags, `alt` among them, and its description): people edit them
    const words = (({ tags, desc }) => ({ ...(tags && { tags }), ...(desc && { desc }) }))(held.clips[v.clip]);
    clips[v.clip] = v.swapped ? { ...fresh.clips[v.clip], ...words } : held.clips[v.clip];
    fit[v.clip] = v.swapped ? v.now : v.was;
  }
  return { set: { ...held, format: 2, fit, clips }, verdicts };
}

/** Set directory `dir`'s originals imported again in format 2, from the repository root `root` (see fetch.ts). */
export function reimport(dir: string, root: string): ClipSet {
  const source = SET_SOURCES[dir];
  if (!source) throw new Error(`${dir} has no originals to re-import: ${Object.keys(SET_SOURCES).join(', ')} do`);
  if (source.status !== 'available') throw new Error(`${dir} is not re-imported: ${source.why}`);
  const held = readSet(dir);
  const catalog = JSON.parse(readFileSync(join(root, 'data/anim/catalogs', `${dir}.json`), 'utf8')) as Catalog;
  const common = { catalog, name: held.set, title: held.title, credit: held.credit };
  if (dir === 'cmu') return importSet({ cmu: true, ...common }).set;
  fetchMesh2Motion(root);
  const glbs = Object.values(held.sources ?? {}).map((s) => ({
    file: s.file as string,
    bytes: readFileSync(join(root, MESH2MOTION_CACHE, s.file as string)),
  }));
  return importSet({ glbs, sources: Object.keys(held.sources ?? {}), ...common }).set;
}

/** `UPGRADE_FILE` as committed (empty when there is none). */
export function readUpgraded(root: string): Record<string, Upgraded> {
  const path = join(root, UPGRADE_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Upgraded>) : {};
}

/** Set `dir`'s line for `UPGRADE_FILE` from its verdicts. */
export function upgradedOf(verdicts: Verdict[]): Upgraded {
  const kept = Object.fromEntries(verdicts.filter((v) => !v.swapped).map((v) => [v.clip, v.why]));
  return { swapped: verdicts.filter((v) => v.swapped).length, of: verdicts.length, kept };
}

/** Writes set `dir`'s line into `UPGRADE_FILE`, the others kept, sets in name order. */
export function writeUpgraded(root: string, dir: string, line: Upgraded): void {
  const all = { ...readUpgraded(root), [dir]: line };
  const sorted = Object.fromEntries(
    Object.keys(all)
      .sort()
      .map((k) => [k, all[k]]),
  );
  writeFileSync(join(root, UPGRADE_FILE), JSON.stringify(sorted, null, 2) + '\n');
}
