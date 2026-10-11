/**
 * @file Verifying the frame rate of CMU takes the site's motion list leaves out (PLAN.md WP 8.5): the ledger read
 * them at an assumed 120 frames a second and flagged them `fps?`. Two kinds of evidence settle a take's rate, and the
 * ledger row records which (data/anim/cmu/README.md):
 * - `fps:c3d`: the take's C3D file on the site (`subjects/NN/NN_MM.c3d`, the capture's marker data) names its rate
 *   in its header, over the same number of frames as its `.amc` (only the first 1 KB is read);
 * - `twin:<id>`: its skeleton and frames are byte for byte those of a take on the list (a candidate has the same
 *   length, active stretch, fit, travel and hips in the ledger), so it has that take's rate.
 *
 * `applyRates` clears the flag and writes the evidence and the rate; a take whose rate changes is then surveyed
 * again (tools/anim/survey.ts), which measures its length, stretch, fit and flags at its true rate.
 *
 * @example
 * const header = new Uint8Array(512);
 * header.set([2, 0x50]); // parameters at block 2, the C3D key
 * new DataView(header.buffer).setUint16(6, 1, true); // the first frame
 * new DataView(header.buffer).setUint16(8, 464, true); // the last
 * new DataView(header.buffer).setFloat32(20, 60, true); // the rate
 * c3dHeader(header); // { rate: 60, frames: 464 }
 * amcFrames('1\nroot 0 0 0 0 0 0\n2\nroot 0 0 0 0 0 0\n'); // 2
 * @see tools/anim/rates.test.ts
 */
import { readFileSync } from 'node:fs';
import { CMU_CACHE, cmuGet, SITE } from './cmu';
import { compareIds, type Ledger } from './ledger';
import { urlSource } from './zip';

/** What settles a take's rate. */
export interface RateEvidence {
  id: string;
  fps: number;
  /** The ledger flags that record it: `fps:c3d`, `twin:<id>`, or both. */
  flags: string[];
  /** What was found, for the report. */
  detail: string;
}

/** A C3D header's point frame rate and number of frames (an Intel-format file; another is refused). */
export function c3dHeader(bytes: Uint8Array): { rate: number; frames: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || bytes[1] !== 0x50) throw new Error('not a C3D file: its second byte is not 0x50');
  const block = bytes[0];
  const processor = bytes.length >= block * 512 ? bytes[(block - 1) * 512 + 3] : 84;
  if (processor !== 84) throw new Error(`a C3D file for processor type ${processor}: only Intel (84) is read`);
  return { rate: view.getFloat32(20, true), frames: view.getUint16(8, true) - view.getUint16(6, true) + 1 };
}

/** How many frames an `.amc` take has. */
export const amcFrames = (text: string) => text.split('\n').filter((line) => /^\d+\s*$/.test(line)).length;

/** A take's frames, without the header line that names the skeleton file it was written against. */
const framesOf = (text: string) => text.slice(text.search(/^1\s*$/m));

/** The rate in a take's C3D file on the site, when it has one there and its frames agree with the `.amc`'s. */
export function c3dEvidence(id: string, amcText: string, read?: (url: string) => Uint8Array) {
  const url = `${SITE}/subjects/${id.split('_')[0]}/${id}.c3d`;
  let header: { rate: number; frames: number };
  try {
    header = c3dHeader((read ?? ((u: string) => urlSource(u).bytes(0, 1023)))(url));
  } catch {
    return null;
  }
  const frames = amcFrames(amcText);
  if (header.frames !== frames) return null;
  return { fps: Math.round(header.rate), detail: `${id}.c3d: ${header.rate} fps, ${frames} frames as its .amc` };
}

/** Listed takes the ledger measured the same as `id` (length, stretch, fit, travel, hips): its possible twins. */
export function twinCandidates(ledger: Ledger, id: string): string[] {
  const take = ledger.takes.find((t) => t.id === id);
  if (!take) return [];
  const key = (t: typeof take) => [t.sec, t.active, t.fit, t.travel, t.hips].join('|');
  return ledger.takes
    .filter(
      (t) => t.id !== id && !t.flags.split(' ').includes('fps?') && !/twin:/.test(t.flags) && key(t) === key(take),
    )
    .map((t) => t.id)
    .sort(compareIds);
}

/**
 * Verifies the rate of each take in `ids` (default: every `fps?` take), downloading what it compares into `dir`;
 * `readC3d` reads the first kilobyte of a C3D file's URL (by default, by an HTTP range).
 */
export function verifyRates(
  ledger: Ledger,
  ids?: string[],
  dir: string = CMU_CACHE,
  readC3d?: (url: string) => Uint8Array,
): RateEvidence[] {
  const wanted = ids ?? ledger.takes.filter((t) => t.flags.split(' ').includes('fps?')).map((t) => t.id);
  const out: RateEvidence[] = [];
  for (const id of [...wanted].sort(compareIds)) {
    const candidates = twinCandidates(ledger, id);
    const files = cmuGet([id, ...candidates], dir);
    const text = (path: string) => readFileSync(path, 'latin1');
    const [mine] = files;
    const twin = files
      .slice(1)
      .find((f) => text(f.asf) === text(mine.asf) && framesOf(text(f.amc)) === framesOf(text(mine.amc)));
    const twinFps = twin && +(ledger.takes.find((t) => t.id === twin.id)?.fps ?? 0);
    const c3d = c3dEvidence(id, text(mine.amc), readC3d);
    if (c3d && twin && c3d.fps !== twinFps)
      throw new Error(`${id}: its C3D says ${c3d.fps} fps, its twin ${twin.id} ${twinFps}`);
    const flags = [...(c3d ? ['fps:c3d'] : []), ...(twin ? [`twin:${twin.id}`] : [])];
    if (!flags.length) continue;
    const said = [c3d?.detail, twin && `${twin.id} (${twinFps} fps on the list) has the same skeleton and frames`];
    out.push({ id, fps: c3d?.fps ?? (twinFps as number), flags, detail: said.filter(Boolean).join('; ') });
  }
  return out;
}

/** Writes the evidence into the ledger's rows: the rate, and the evidence in place of `fps?`. Returns rates changed. */
export function applyRates(ledger: Ledger, evidence: RateEvidence[]): string[] {
  const changed: string[] = [];
  for (const e of evidence) {
    const take = ledger.takes.find((t) => t.id === e.id);
    if (!take) continue;
    const flags = take.flags.split(' ').filter((f) => f && f !== 'fps?' && !/^(fps:c3d|twin:)/.test(f));
    take.flags = [...e.flags, ...flags].join(' ');
    if (+take.fps !== e.fps) changed.push(e.id);
    take.fps = String(e.fps);
  }
  return changed;
}
