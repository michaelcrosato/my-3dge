/**
 * @file The "Start here" section that opens `docs/INDEX.md` (PLAN.md §6.8): the task guides AGENTS.md lists under
 * "Where things are", then every skill in `.claude/skills/`, with its description's headline and the sentence that
 * says when to load it. A newcomer reaches the guides from either file, and the list is written once, in AGENTS.md.
 *
 * AGENTS.md's guides are the bullets after the line that starts with "Task guides", up to the next blank line, each
 * `- <path>: <what it is for>` (a bullet may run on over lines indented by two spaces); the skills go under the guide
 * whose path is in `.claude/skills/`, else under a bullet of their own. Their paths are drift-checked
 * where AGENTS.md is (tools/lib/docsPaths.ts), and the skills are read from the directory, so the section names
 * nothing that is gone; INDEX's own drift check catches a guide or skill added without `x docs --write`.
 *
 * Invariants: it reads files only, never runs anything; skills come in name order. A repository whose AGENTS.md lists
 * no guide and which has no skill gets no section.
 *
 * @example
 * const guides = taskGuides('Task guides:\n- docs/PROGRESS.md: read first.\n\nmore');
 * guides; // [{ path: 'docs/PROGRESS.md', what: 'read first.' }]
 * whenToLoad('Writing three.js code — idioms, traps. Use before writing code that imports three.js.');
 * // 'Writing three.js code. Use before writing code that imports three.js.'
 * @see tools/cmd/docs.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One task guide: a repository path and what it is for. */
export interface Guide {
  path: string;
  what: string;
}

/** One skill: its name, its SKILL.md path and when to load it. */
export interface Skill {
  name: string;
  path: string;
  when: string;
}

/** The skills' directory. */
export const SKILLS = '.claude/skills';

/** The task guides an AGENTS.md text lists: the `- <path>: <what>` bullets after its "Task guides" line. */
export function taskGuides(agents: string): Guide[] {
  const lines = agents.split('\n');
  const start = lines.findIndex((line) => line.startsWith('Task guides'));
  if (start < 0) return [];
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    if (line.startsWith('- ')) bullets.push(line.slice(2).trim());
    else if (line.startsWith('  ') && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else break;
  }
  return bullets.flatMap((bullet) => {
    const match = /^`?([^\s`:]+)`?: (.+)$/.exec(bullet);
    return match ? [{ path: match[1], what: match[2] }] : [];
  });
}

/**
 * A skill's description in short: its first sentence up to a dash (what it is), then the sentence that says when to
 * load it ("Use when…"), when there is one.
 */
export function whenToLoad(description: string): string {
  const sentences = description.trim().split(/(?<=[.!?])\s+/); // three.js and 0.21 end no sentence
  const headline = (sentences[0] ?? '').split(/\s[—-]\s/)[0].replace(/[.!?]$/, '');
  const use = sentences.slice(1).filter((sentence) => /^Use\b/.test(sentence));
  return [`${headline}.`, ...use.slice(-1)].join(' ');
}

/** Every skill under `.claude/skills/` in `root`, from its SKILL.md front matter, in name order. */
export function skills(root: string): Skill[] {
  const dir = join(root, SKILLS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = `${SKILLS}/${name}/SKILL.md`;
      const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(root, path), 'utf8'))?.[1] ?? '';
      const description = /^description:\s*(.+)$/m.exec(front)?.[1] ?? '';
      return { name, path, when: whenToLoad(description) };
    });
}

/** INDEX's "Start here" section as Markdown lines (links relative to `docs/`), or [] with no guide and no skill. */
export function startHere(root: string): string[] {
  const agents = join(root, 'AGENTS.md');
  const guides = existsSync(agents) ? taskGuides(readFileSync(agents, 'utf8')) : [];
  const found = skills(root);
  if (!guides.length && !found.length) return [];
  const link = (path: string) => (/[<*…]/.test(path) ? `\`${path}\`` : `[\`${path}\`](../${path})`);
  const out = [
    '',
    '## Start here',
    '',
    'The task guides, as AGENTS.md lists them under "Where things are", and the skills: read each when the task needs',
    'it.',
    '',
  ];
  const nested = found.map((skill) => `  - ${link(skill.path)}: ${skill.when}`);
  for (const guide of guides) {
    out.push(`- ${link(guide.path)}: ${guide.what}`);
    if (guide.path.startsWith(SKILLS)) out.push(...nested.splice(0)); // the skills under AGENTS.md's own bullet
  }
  if (nested.length) out.push(`- The skills, in \`${SKILLS}/\`, each loaded when its description says:`, ...nested);
  return out;
}
