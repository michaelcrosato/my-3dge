/**
 * @file `x anim cmu …` (PLAN.md §5.3, WP 8.5): the CMU database's subcommands, ported from `my-3d2dge:tools/cmu.mjs`
 * (`find`, `subject`, `get`, `all`, `survey`, `library`, `ledger`) with the ledger split and every take fetched into
 * `.cache/anim/cmu/` by HTTP ranges (tools/anim/cmu.ts), plus `rates`, which verifies the frame rate of takes the
 * site's list leaves out (tools/anim/rates.ts). tools/cmd/anim.ts calls `runCmu`; its file comment has the usage.
 *
 * Invariants: what writes the ledger (`survey`, `rates --write`) keeps every row's note; `--legacy` surveys as
 * my-3d2dge did (nearest source frames), the way the committed ledger was measured. `--json` writes every row found
 * beside the report (`cmu.json`), the printed lines being the first of them.
 *
 * @example
 * // node x anim cmu ledger cartwheel --status used   → 49_06 … USED: Cartwheel
 * // node x anim cmu get 02_01                        → .cache/anim/cmu/02.asf and 02_01.amc, read by ranges
 * cmuTargets(['ledger', 'cartwheel']); // 'cmu-ledger-cartwheel'
 * @see tools/cmd/anim.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CommandResult } from '../x';
import { CMU_CACHE, cmuAll, cmuGet, cmuIndex } from './cmu';
import { queryLedger, readLedger, writeLedger, type Take } from './ledger';
import { applyRates, verifyRates } from './rates';
import { LIBRARY_DIR, surveyCmu } from './survey';

/** What `runCmu` needs: the words after `cmu`, the flags, and the repository root (for paths it prints). */
export interface CmuRequest {
  args: string[];
  values: Record<string, unknown>;
  root: string;
  /** Where `--json` writes, repository-relative. */
  jsonPath: string;
}

/** The report target of `x anim cmu …`. */
export const cmuTargets = (args: string[]) => ['cmu', ...args.slice(0, 3)].join('-');

const SUBCOMMANDS = ['find', 'subject', 'get', 'all', 'survey', 'library', 'ledger', 'rates'] as const;
/** The `cmu` subcommands. */
export const CMU_SUBCOMMANDS: readonly string[] = SUBCOMMANDS;

/** A take's ledger line. */
const takeLine = (r: Take) =>
  [
    r.id,
    `${r.sec} s`,
    r.category,
    `active ${r.active}`,
    `fit ${r.fit}`,
    r.flags,
    r.used ? `USED: ${r.used}` : '',
    r.note,
    r.desc,
  ]
    .filter((x) => x && x !== ' s')
    .join('\t');

/** Writes `rows` as JSON beside the report when `--json` asks; the artifact it made, if any. */
function json(request: CmuRequest, rows: unknown) {
  if (!request.values.json) return [];
  const path = join(request.root, request.jsonPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
  return [{ path: request.jsonPath, kind: 'json', describes: 'every row found, as JSON' }];
}

/** Runs `x anim cmu <sub> …`; throws plain errors for bad arguments (the caller makes them usage errors). */
export function runCmu(request: CmuRequest): CommandResult & { usage?: string } {
  const [sub = '', ...words] = request.args;
  const { values } = request;
  const subjects = typeof values.subjects === 'string' ? values.subjects.split(',').map(Number) : undefined;
  const legacy = values.legacy === true;
  const rel = (path: string) => relative(request.root, path);
  switch (sub) {
    case 'find':
    case 'subject': {
      const q = words.map((w) => w.toLowerCase());
      if (!q.length)
        return { ok: false, summary: '', usage: `cmu ${sub} needs ${sub === 'find' ? 'words' : 'a subject number'}` };
      const index = cmuIndex();
      const hits =
        sub === 'subject'
          ? index.filter((t) => t.subject === +q[0])
          : index.filter((t) => q.every((w) => `${t.desc} ${t.about}`.toLowerCase().includes(w)));
      const lines = hits.map((t) => `${t.id}\t${t.fps} fps\t${t.desc}\t(${t.about})`);
      return { ok: true, summary: `${hits.length} take(s) on the site's list`, lines, artifacts: json(request, hits) };
    }
    case 'get': {
      if (!words.length) return { ok: false, summary: '', usage: 'cmu get needs take ids, like 02_01' };
      const files = cmuGet(words);
      return {
        ok: true,
        summary: `${files.length} take(s) in ${rel(CMU_CACHE)}`,
        lines: files.map((f) => `${f.id}: ${rel(f.amc)}`),
      };
    }
    case 'all':
      return { ok: true, summary: `${cmuAll()} takes in ${rel(CMU_CACHE)}, read from the archive by ranges` };
    case 'survey':
    case 'library': {
      const library = sub === 'library';
      const tol = typeof values.tol === 'string' ? +values.tol : library ? 50 : 30;
      const options = library ? { library, ledger: false, libraryTol: tol } : { tol };
      const r = surveyCmu({ ...options, subjects, legacy });
      const where = library ? `set directories in ${rel(LIBRARY_DIR)}` : `the ledger in data/anim/cmu/`;
      return {
        ok: true,
        summary: `converted ${r.done} takes (${(r.secs / 3600).toFixed(1)} h of motion) into ${where}`,
      };
    }
    case 'ledger': {
      const status = typeof values.status === 'string' ? values.status : undefined;
      const hits = queryLedger(readLedger(), words, status);
      const top = typeof values.top === 'string' ? +values.top : Infinity;
      const cats = new Map<string, number>();
      for (const r of hits) cats.set(r.category || '-', (cats.get(r.category || '-') ?? 0) + 1);
      const by = [...cats].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`);
      return {
        ok: true,
        summary: `${hits.length} take(s): ${by.join(', ') || 'none'}`,
        lines: hits.slice(0, top).map(takeLine),
        artifacts: json(request, hits),
      };
    }
    case 'rates': {
      const ledger = readLedger();
      const evidence = verifyRates(ledger, words.length ? words : undefined);
      const lines = evidence.map((e) => `${e.id}\t${e.fps} fps\t${e.flags.join(' ')}\t${e.detail}`);
      const left = (
        words.length ? words : ledger.takes.filter((t) => t.flags.includes('fps?')).map((t) => t.id)
      ).filter((id) => !evidence.some((e) => e.id === id));
      const warnings = left.map((id) => ({
        id: 'ANIM_RATE_UNVERIFIED',
        message: `${id}: no C3D file and no twin on the site's list: its rate stays assumed`,
      }));
      if (!values.write)
        return {
          ok: true,
          summary: `${evidence.length} rate(s) verified (--write records them)`,
          lines,
          warnings,
          artifacts: json(request, evidence),
        };
      const changed = applyRates(ledger, evidence);
      writeLedger(ledger);
      const again = [...new Set(changed.map((id) => +id.split('_')[0]))];
      if (again.length) surveyCmu({ subjects: again, legacy: true });
      const summary = `${evidence.length} rate(s) recorded; ${changed.length} changed, their subjects (${again.join(', ') || 'none'}) surveyed again`;
      return { ok: true, summary, lines, warnings, artifacts: json(request, evidence) };
    }
    default:
      return { ok: false, summary: '', usage: `x anim cmu takes one of ${SUBCOMMANDS.join(', ')}` };
  }
}
