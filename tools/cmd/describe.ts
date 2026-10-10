/**
 * @file Lists the registries from their schemas (PLAN.md §8.1, §6.6): `x describe` names every kind with its entry
 * count, `x describe <kind>` gives its fields (type, default, range, unit, docs) and ids, and `x describe <kind> <id>`
 * one entry's values, `*` marking those that differ from the default. Settings are the kind `setting`. In a page,
 * `__engine.describe(kind?, id?)` returns the same data (WP 1.6).
 *
 * Kinds plug in by themselves, as `x check` plugins do: nothing here names one. The command imports, in Node, every
 * module under `engine/`, `labs/` and `fixtures/` (tests aside) whose text calls `def(…)` or a `define…(…)` function
 * other than `defineCodes` (`defineKind`, `defineSettings`, WP 1.5's `defineScene`…), then lists the shared registry of
 * engine/core/registry.ts. So a module that registers content keeps its top level free of page-only work; one that
 * cannot load in Node is a warning naming it, and the listing goes on without it.
 *
 * Output: at most about 20 lines; the whole description is in `describe.json` beside the report. An unknown kind
 * or id is a usage error (exit 2) naming the closest.
 *
 * Usage: node x describe [kind [id]]. Exit 0 when the listing is complete or only warned about modules.
 * @see tools/cmd/describe.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../../engine/core/log';
import { registry, type EntryDescription, type KindDescription } from '../../engine/core/registry';
import type { FieldRow } from '../../engine/core/schema';
import { walk } from '../lib/docs';
import { targetSlug, type Finding } from '../lib/report';
import { UsageError, type Command, type CommandResult } from '../x';

/** Where modules that register content live. */
export const REGISTRATION_ROOTS = ['engine', 'labs', 'fixtures'];

/** A call that registers content: `def(…)` or `define<Name>(…)` other than `defineCodes`, not its declaration. */
const REGISTERS = /(?<!function\s+)(?<![\w$])(?:def|define(?!Codes\b)[A-Z]\w*)\s*\(/;

/** The modules under `root` that register content, repository-relative and sorted. */
export function registrationModules(root: string): string[] {
  return REGISTRATION_ROOTS.flatMap((dir) => walk(root, dir))
    .sort()
    .filter(
      (file) =>
        /\.(ts|js|mjs)$/.test(file) &&
        !/\.(test|spec)\.ts$|\.d\.ts$/.test(file) &&
        REGISTERS.test(readFileSync(join(root, file), 'utf8')),
    );
}

/** Imports each module that registers content; a module that fails becomes a warning. */
export async function loadRegistrations(root: string): Promise<{ loaded: string[]; warnings: Finding[] }> {
  const loaded: string[] = [];
  const warnings: Finding[] = [];
  for (const file of registrationModules(root)) {
    try {
      await import(pathToFileURL(join(root, file)).href);
      loaded.push(file);
    } catch (error) {
      const why = (error instanceof Error ? error.message : String(error)).split('\n')[0];
      const message = `${file} did not load in Node (${why}): its kinds and entries are missing from this listing; keep page-only work out of the top level of a module that registers content`;
      warnings.push({ id: 'DESCRIBE_LOAD', message, file });
    }
  }
  return { loaded, warnings };
}

/** One value, short, for a line. */
function brief(value: unknown, room = 40): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return text.length > room ? `${text.slice(0, room - 3)}...` : text;
}

/** One line for a field: name, type, default, range, unit, values, flags, then its description. */
export function fieldLine(field: FieldRow): string {
  const parts: string[] = [field.type];
  if (field.default !== undefined) parts.push(`= ${field.default === 'function' ? 'function' : brief(field.default)}`);
  if (field.minimum !== undefined || field.maximum !== undefined) {
    parts.push(`${field.minimum ?? '-inf'}..${field.maximum ?? 'inf'}`);
  }
  if (field.unit) parts.push(field.unit);
  if (field.enum) parts.push(`one of ${field.enum.map((value) => brief(value, 20)).join('|')}`);
  if (field.required) parts.push('required');
  if (field.view) parts.push('view');
  if (field.when && field.when !== 'now') parts.push(`when ${field.when}`);
  const line = `  ${field.key}: ${parts.join(', ')}${field.description ? `: ${field.description}` : ''}`;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** What one listing prints, besides the verdict. */
function listing(
  kind: string | undefined,
  id: string | undefined,
): { summary: string; lines: string[]; data: unknown } {
  if (kind === undefined) {
    const data = registry.describe();
    const entries = data.kinds.reduce((sum, row) => sum + row.count, 0);
    const lines = data.kinds.map((row) => {
      const line = `${row.kind} (${row.count}): ${row.description}`;
      return line.length > 140 ? `${line.slice(0, 137)}...` : line;
    });
    return { summary: `${data.kinds.length} kinds, ${entries} entries`, lines, data };
  }
  if (id === undefined) {
    const data: KindDescription = registry.describe(kind);
    const ids = data.ids.length ? `ids: ${data.ids.join(', ')}` : 'ids: none yet';
    const lines = [
      data.description,
      ...(data.fallback ? [`fallback: ${data.fallback}`] : []),
      ...data.fields.map(fieldLine),
      ids.length > 400 ? `${ids.slice(0, 397)}...` : ids,
    ];
    return { summary: `${kind}: ${data.fields.length} fields, ${data.ids.length} entries`, lines, data };
  }
  const data: EntryDescription = registry.describe(kind, id);
  const changed = data.fields.filter((field) => field.differs).length;
  const lines = data.fields.map((field) => `${field.differs ? '*' : ' '} ${field.key} = ${brief(field.value, 100)}`);
  return {
    summary: `${kind} ${JSON.stringify(id)}: ${changed} of ${data.fields.length} fields differ from the default`,
    lines,
    data,
  };
}

export default {
  usage: 'describe [kind [id]]',
  options: {},
  maxPositionals: 2,
  async run({ root, positionals }): Promise<CommandResult> {
    const [kind, id] = positionals;
    const { loaded, warnings } = await loadRegistrations(root);
    let result: ReturnType<typeof listing>;
    try {
      result = listing(kind, id);
    } catch (error) {
      if (error instanceof EngineError && (error.code === 'CORE_UNKNOWN_KIND' || error.code === 'CORE_NO_ENTRY')) {
        throw new UsageError(error.message.replace(/^\[\w+\] /, ''));
      }
      throw error;
    }
    const target = [kind, id].filter(Boolean).join(' ') || undefined;
    const dir = join('out', 'describe', targetSlug(target));
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'describe.json'), `${JSON.stringify(result.data, null, 2)}\n`);
    return {
      ok: true,
      summary: result.summary,
      lines: result.lines,
      target,
      warnings,
      metrics: { modules: loaded.length, kinds: registry.kinds().length },
      artifacts: [
        {
          path: `${dir}/describe.json`,
          kind: 'json',
          describes: 'the whole description, as registry.describe returns it',
        },
      ],
    };
  },
} satisfies Command;
