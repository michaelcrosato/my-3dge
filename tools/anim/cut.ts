/**
 * @file A smaller set cut from bigger ones (PLAN.md §5.3, WP 8.5): the clips a game adopts, with the records of the
 * libraries they came from (their rest bodies and origins) and the mannequin's look, read from and written as set
 * directories, one file a clip (tools/anim/repack.ts). No source files needed. Ported from
 * `my-3d2dge:tools/anim-set.mjs`; the first set's first library leads (the source's rule), and `from` is always a list.
 *
 * Invariants: a clip is picked by its name, or as `SET:Clip` (the set's name or its directory's) when two sets have
 * it; a clip picked twice, a name no set has, and two sets that name different libraries alike are errors that say
 * so. Each clip keeps its `fit` entry and its library's record.
 *
 * @example
 * import { readSet } from './repack';
 * const set = cutSet([readSet('quaternius'), readSet('cmu')], ['QUATERNIUS:Walk_Loop', 'Cartwheel'], { name: 'HERO' });
 * [Object.keys(set.clips), set.from]; // [['Walk_Loop', 'Cartwheel'], ['QUATERNIUS', 'CMU']]
 * Object.keys(set.sources ?? {}); // ['UAL1', 'CMU_49']: the lead library first
 * @see tools/anim/cut.test.ts
 */
import type { Clip } from '../../engine/anim/clip/readable';
import type { ClipSet, ClipSource } from '../../engine/anim/clip/validate';
import { setDirName } from './repack';

/** Cuts the clips `picks` out of `sets` into a new set named `name` (see the file comment). */
export function cutSet(
  sets: ClipSet[],
  picks: string[],
  options: { name: string; title?: string; credit?: string },
): ClipSet {
  if (!sets.length) throw new Error('cut needs at least one set to pick from: name the sets first');
  const [clips, fit, used, from] = [
    {} as Record<string, Clip>,
    {} as Record<string, [number, number]>,
    new Set<string>(),
    [] as string[],
  ];
  const names = sets.map((s) => s.set).join(', ');
  for (const want of picks) {
    const [setName, clipName] = want.includes(':') ? (want.split(':') as [string, string]) : [null, want];
    const matches = (s: ClipSet) => !setName || s.set === setName || setDirName(s.set) === setName.toLowerCase();
    const hits = sets.filter((s) => matches(s) && s.clips[clipName]);
    if (!hits.length) throw new Error(`no clip ${want} in ${names}: x anim find ${clipName} lists the clips`);
    if (hits.length > 1)
      throw new Error(`${clipName} is in ${hits.map((s) => s.set).join(' and ')}: pick one as SET:${clipName}`);
    if (clips[clipName]) throw new Error(`${clipName} is picked twice: pick it once`);
    const [S, c] = [hits[0], hits[0].clips[clipName]];
    if (!c.src || !S.sources?.[c.src])
      throw new Error(`${S.set} ${clipName}: its library ${c.src} is not on record in its set`);
    clips[clipName] = c;
    const entry = S.fit?.[clipName];
    if (entry) fit[clipName] = entry;
    used.add(`${S.set}/${c.src}`);
    if (!from.includes(S.set)) from.push(S.set);
  }
  // the libraries the picked clips came from, with their records; the first set's first library leads
  const first = sets[0];
  const lead = Object.keys(first.sources ?? {})[0];
  const sources: Record<string, ClipSource> = lead
    ? { [lead]: (first.sources as Record<string, ClipSource>)[lead] }
    : {};
  for (const S of sets) {
    for (const [id, record] of Object.entries(S.sources ?? {})) {
      if (!used.has(`${S.set}/${id}`)) continue;
      if (sources[id] && JSON.stringify(sources[id]) !== JSON.stringify(record))
        throw new Error(`two sets name different libraries ${id}: rename one in its set`);
      sources[id] = record;
    }
  }
  return {
    set: options.name,
    ...(options.title ? { title: options.title } : {}),
    ...(first.format ? { format: first.format } : {}),
    credit: options.credit ?? first.credit,
    from,
    ...(first.fps ? { fps: first.fps } : {}),
    sources,
    body: first.body ?? null,
    fit,
    clips,
  };
}
