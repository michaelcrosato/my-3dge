/**
 * @file The public API by area, for docs/GAME-GUIDE.md's last section (PLAN.md WP 12.4, ADR-0024): each area comment
 * of the barrels, in their order (engine/sim-api.ts with the areas engine/anim/api.ts adds in its place, then
 * engine/index.ts), with the names the area exports, values first, then types. `x docs --write` puts it between the
 * guide's `api-map` markers, and `x docs --check` fails while the block differs, so the one file a game agent (or a
 * model without the repository) reads names every public export and never drifts from the code; it also holds the
 * whole guide to `GUIDE_BUDGET_BYTES`. The rest of the guide
 * is hand-written, and Prettier leaves it alone (.prettierignore), so this block is written as it should stay.
 *
 * Invariants: the barrels are flat lists of `export { name } from …` and `export type { Name } from …` lines under `//`
 * area comments (their file comments say so); `export * from './x'` puts x's areas in its place. An area with no names
 * of its own (a heading whose names live in another file) is left out.
 *
 * @example
 * apiMap(process.cwd()).includes('`defineScene`'); // true
 * withApiMap('a\n<!-- api-map:start -->\nold\n<!-- api-map:end -->\n', 'new'); // 'a\n<!-- api-map:start -->\nnew\n<!-- api-map:end -->\n'
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Finding } from './report';

/** The guide whose last section this module writes. */
export const GUIDE = 'docs/GAME-GUIDE.md';

/**
 * The most the guide may weigh, in bytes (about 15,000 tokens): it is read whole, once, by every game agent, and handed
 * as one file to models without the repository. It weighed 43 KB when written (ADR-0024).
 */
export const GUIDE_BUDGET_BYTES = 60_000;

/** The markers around the generated block; the start marker's comment may run on to say what writes the block. */
const START = '<!-- api-map:start';
const END = '<!-- api-map:end -->';

/** One area of a barrel: its comment and the names it exports. */
export interface ApiArea {
  /** The comment above it, its lines joined. */
  text: string;
  values: string[];
  types: string[];
}

/** The areas of the barrel at `file` (repository path), with `export *` lines replaced by the target's areas. */
export function barrelAreas(root: string, file: string): ApiArea[] {
  const areas: ApiArea[] = [];
  let area: ApiArea | null = null;
  let continuing = false;
  for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
    const comment = /^\/\/ (.*)$/.exec(line)?.[1];
    if (comment !== undefined) {
      if (continuing && area) area.text += ` ${comment}`;
      else areas.push((area = { text: comment, values: [], types: [] }));
      continuing = true;
      continue;
    }
    continuing = false;
    const star = /^export \* from '(\.[^']+)';$/.exec(line)?.[1];
    if (star) areas.push(...barrelAreas(root, `${posix.join(posix.dirname(file), star)}.ts`));
    const named = /^export (type )?\{ (\w+) \} from /.exec(line);
    if (named && area) (named[1] ? area.types : area.values).push(named[2]);
  }
  return areas.filter((entry) => entry.values.length + entry.types.length > 0);
}

/** One area as Markdown: its comment, its title (the words before the first colon) in bold, then its names. */
function areaMarkdown(area: ApiArea): string {
  const colon = area.text.indexOf(':');
  const text = colon > 0 && colon < 80 ? `**${area.text.slice(0, colon)}**${area.text.slice(colon)}` : area.text;
  const names = [
    area.values.map((name) => `\`${name}\``).join(', '),
    area.types.length ? `types ${area.types.map((name) => `\`${name}\``).join(', ')}` : '',
  ].filter(Boolean);
  return `${text}\n${names.join('; ')}.`;
}

/** The section's body: the sim-side barrel's areas, then the page barrel's own. */
export function apiMap(root: string): string {
  const sim = barrelAreas(root, 'engine/sim-api.ts');
  const page = barrelAreas(root, 'engine/index.ts').filter((area) => !sim.some((other) => other.text === area.text));
  return [
    'Sim-side code imports these from engine/sim-api.ts; pages get them from engine/index.ts as well. Each name has the',
    'first sentence of its doc comment in docs/API.md, and its whole manual where it is declared.',
    '',
    ...sim.flatMap((area) => [areaMarkdown(area), '']),
    'Pages only, from engine/index.ts:',
    '',
    ...page.flatMap((area) => [areaMarkdown(area), '']),
  ]
    .join('\n')
    .trimEnd();
}

/** `text` with the block between the markers replaced by `map`; throws when the markers are missing. */
export function withApiMap(text: string, map: string): string {
  const start = text.indexOf(START);
  const end = text.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error(`${GUIDE} lacks its markers, ${START} … --> and ${END}`);
  const open = text.indexOf('\n', start) + 1;
  return `${text.slice(0, open)}${map}\n${text.slice(end)}`;
}

/** The guide as `x docs --write` leaves it, or null when this repository has no guide. */
export function currentGuide(root: string): string | null {
  const path = join(root, GUIDE);
  return existsSync(path) ? withApiMap(readFileSync(path, 'utf8'), apiMap(root)) : null;
}

/** The drift findings for the guide: its markers missing, its block stale, or the whole over its budget. */
export function guideFindings(root: string): Finding[] {
  const path = join(root, GUIDE);
  if (!existsSync(path)) return [];
  const bytes = Buffer.byteLength(readFileSync(path, 'utf8'));
  if (bytes > GUIDE_BUDGET_BYTES) {
    const message = `${GUIDE} weighs ${bytes} bytes, over its ${GUIDE_BUDGET_BYTES}: every game agent reads it whole, so cut prose (point at the code's comments) rather than raise the budget`;
    return [{ id: 'DOCS_GUIDE', message, file: GUIDE }];
  }
  try {
    if (currentGuide(root) === readFileSync(path, 'utf8')) return [];
    const message = `${GUIDE}'s public API section is stale: run node x docs --write (it comes from the barrels' area comments; edit those)`;
    return [{ id: 'DOCS_STALE', message, file: GUIDE }];
  } catch (error) {
    return [{ id: 'DOCS_GUIDE', message: `${(error as Error).message}: put them back around section 10`, file: GUIDE }];
  }
}

/** Writes the guide's block when it differs; returns whether it wrote. */
export function writeGuide(root: string): boolean {
  const next = currentGuide(root);
  const path = join(root, GUIDE);
  if (next === null || next === readFileSync(path, 'utf8')) return false;
  writeFileSync(path, next);
  return true;
}
