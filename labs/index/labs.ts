/**
 * @file The labs index's data (labs/labs.json; PLAN.md WP 10.8, carried from `my-3d2dge:src/labs.json`, with an answer
 * and an expiry date added): sections of entries, each a page under labs/ with its links, what it is for and the `x`
 * command that does the same job without the page. A temporary lab (section `temporary`) also says when it was added,
 * the question it answers, its answer once settled, and the date it expires. The index page (labs/index/main.ts),
 * `x lab` (tools/cmd/lab.ts) and the labs suite (tests/e2e/labs.spec.ts) all read it through here.
 *
 * Invariants: dates are `YYYY-MM-DD`; a link is `[label, what to add to the page's address]` (`''`, `?a=b`, `#x`);
 * `checkLabs` lists every problem with the file, each naming its fix.
 *
 * @example
 * const index = { $about: '', sections: [{ id: 'temporary', title: 'Temporary labs', entries: [{ page: 'glow', title: 'Glow', what: 'Bloom against the tone map.', command: 'node x shot labs/glow', links: [['Open', '']], added: '2026-10-24', question: 'Does bloom read at night?', expires: '2026-11-07' }] }] };
 * checkLabs(index); // []
 * expiredLabs(index, '2026-11-08').map((lab) => lab.page); // ['glow']
 * labLinks(index)[0].href; // '../glow/'
 */

/** One lab or page: where it lives, its links, what it is for, its `x` command; a temporary one's question and dates. */
export interface LabRecord {
  page: string;
  title: string;
  what: string;
  command: string;
  links: [label: string, suffix: string][];
  added?: string;
  question?: string;
  answer?: string;
  expires?: string;
}

/** A section of the index: the engine's pages, the labs kept, the temporary ones. */
export interface LabsSection {
  id: string;
  title: string;
  entries: LabRecord[];
}

/** labs/labs.json. */
export interface LabsIndex {
  $about: string;
  sections: LabsSection[];
}

/** The sections the index has, in order. */
export const SECTIONS = ['pages', 'keep', 'temporary'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every link of the index, from the index page's own directory: its address, its label and its page. */
export function labLinks(index: LabsIndex): { href: string; label: string; page: string }[] {
  return index.sections.flatMap(
    (section) =>
    section.entries.flatMap((lab) => lab.links.map(([label, suffix]) => ({ href: `../${lab.page}/${suffix}`, label, page: lab.page }))), // prettier-ignore
  );
}

/** The temporary labs whose `expires` date is before `today` (`YYYY-MM-DD`). */
export function expiredLabs(index: LabsIndex, today: string): LabRecord[] {
  const temporary = index.sections.find((section) => section.id === 'temporary')?.entries ?? [];
  return temporary.filter((lab) => (lab.expires ?? '') < today);
}

/** Every problem with `index` (see the file comment), each naming its fix; none when it is sound. */
export function checkLabs(index: LabsIndex): string[] {
  const problems: string[] = [];
  const ids = index.sections.map((section) => section.id);
  if (ids.join() !== SECTIONS.join()) problems.push(`the sections are ${ids.join(', ')}: keep ${SECTIONS.join(', ')}, in that order`); // prettier-ignore
  const seen = new Set<string>();
  for (const section of index.sections) {
    for (const lab of section.entries) {
      const where = `${section.id}/${lab.page}`;
      if (seen.has(lab.page)) problems.push(`${where}: listed twice: keep one entry a page`);
      seen.add(lab.page);
      if (!/^[a-z][a-z0-9-]*$/.test(lab.page)) problems.push(`${where}: a page is a directory under labs/, lowercase`);
      for (const field of ['title', 'what', 'command'] as const)
        if (!lab[field]?.trim()) problems.push(`${where}: no ${field}: say it in a few words`);
      if (!lab.command?.includes('node x')) problems.push(`${where}: its command names no node x command: name the one that does the job without the page`); // prettier-ignore
      if (!lab.links?.length) problems.push(`${where}: no links: give it at least ["Open", ""]`);
      const temporary = section.id === 'temporary';
      for (const field of ['added', 'question', 'expires'] as const) {
        if (temporary && !lab[field]) problems.push(`${where}: a temporary lab needs ${field}`);
        if (!temporary && lab[field]) problems.push(`${where}: ${field} is a temporary lab's: move it to temporary, or drop ${field}`); // prettier-ignore
      }
      for (const field of ['added', 'expires'] as const)
        if (lab[field] && !DATE.test(lab[field])) problems.push(`${where}: ${field} is a date, YYYY-MM-DD`);
      if (lab.added && lab.expires && lab.expires < lab.added)
        problems.push(`${where}: it expires before it was added`);
    }
  }
  return problems;
}
