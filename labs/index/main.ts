/**
 * @file The labs index's page (labs/index/index.html; PLAN.md WP 10.8): labs/labs.json as sections of entries, each
 * with its links, what it is for and the `x` command that does the same job without the page; a temporary lab also
 * shows its question, its answer when settled and the date it expires, marked once past it.
 *
 * The same job without the page: `node x lab list`.
 *
 * @example
 * // labs/index/ lists every link of labs/labs.json in #list
 * @see tests/e2e/labs.spec.ts
 */
import labs from '../labs.json';
import { el } from './lab';
import type { LabsIndex } from './labs';

const index = labs as LabsIndex;
const today = new Date().toISOString().slice(0, 10);
const list = document.getElementById('list')!;
for (const section of index.sections) {
  if (!section.entries.length && section.id === 'temporary') continue;
  list.append(el(document, 'h2', {}, section.title));
  for (const lab of section.entries) {
    const links = lab.links.flatMap(([label, suffix], i) => [
      ...(i ? [' · '] : []),
      el(document, 'a', { href: `../${lab.page}/${suffix}` }, label),
    ]);
    const notes =
      section.id === 'temporary'
        ? [
            el(document, 'p', {}, `Question: ${lab.question ?? ''}`),
            ...(lab.answer ? [el(document, 'p', {}, `Answer: ${lab.answer}`)] : []),
            el(document, 'p', (lab.expires ?? '') < today ? { class: 'expired' } : {}, `Added ${lab.added}, expires ${lab.expires}`), // prettier-ignore
          ]
        : [];
    list.append(
      el(document, 'div', { class: 'lab', 'data-page': lab.page },
        el(document, 'h3', {}, lab.title),
        el(document, 'p', {}, lab.what),
        el(document, 'p', {}, el(document, 'code', {}, lab.command)),
        ...notes,
        el(document, 'p', {}, ...links),
      ), // prettier-ignore
    );
  }
}
