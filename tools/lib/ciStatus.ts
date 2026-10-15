/**
 * @file Where main's full run stands (ADR-0023): `x ci --status` reads the GitHub workflow's runs on main
 * (.github/workflows/ci.yml, which runs `node x ci --local --full` after each merge) through GitHub's REST API, with
 * curl, which honours the environment's proxy, and no token: the repository is public. It names the last finished
 * run's verdict and any newer run still going. The SessionStart hook prints it, so a red main is the first thing an
 * agent sees, and fixes before other work (AGENTS.md).
 *
 * Invariants: it never fails for want of an answer: with no GitHub origin, offline or refused, it says the status is
 * unknown and passes. Only a finished run that did not pass fails it; a cancelled or skipped one is passed over.
 *
 * @example
 * repoSlug('https://github.com/michaelcrosato/my-3dge.git'); // 'michaelcrosato/my-3dge'
 * const run = { status: 'completed', conclusion: 'success', head_sha: 'c0ffee0', html_url: '', created_at: '2026-10-15T06:41:15Z' };
 * const result = await mainStatus('o/r', async () => [run]); // readRuns asks GitHub instead
 * result.summary; // "main's last full run passed on c0ffee0 (2026-10-15 06:41 UTC)"; result.ok is false only on red
 * @see tools/lib/ciStatus.test.ts
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommandResult } from '../x';

/** One run of the workflow, as GitHub's API gives it: the fields read here. */
export interface WorkflowRun {
  /** `queued`, `in_progress`, `completed`… */
  status: string;
  /** `success`, `failure`, `cancelled`, `timed_out`…; null until it completes. */
  conclusion: string | null;
  head_sha: string;
  html_url: string;
  /** ISO 8601. */
  created_at: string;
}

/** Reads the workflow's runs on main for `slug` (`owner/repo`), newest first; rejects when GitHub cannot be asked. */
export type RunsReader = (slug: string) => Promise<WorkflowRun[]>;

/** The workflow whose runs are read. */
export const WORKFLOW = 'ci.yml';

/** `owner/repo` from a GitHub remote URL (https, ssh, or a git proxy's `…/git/owner/repo`), else undefined. */
export function repoSlug(url: string | undefined): string | undefined {
  const match = url ? /(?:github\.com[:/]|\/git\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) : null;
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** The real reader: GitHub's API through curl, 15 s at most. */
export const readRuns: RunsReader = async (slug) => {
  const url = `https://api.github.com/repos/${slug}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=20`;
  const accept = 'Accept: application/vnd.github+json';
  const args = ['--fail', '--silent', '--show-error', '--location', '--max-time', '15', '-H', accept, url];
  const { stdout } = await promisify(execFile)('curl', args, { maxBuffer: 16 << 20 });
  const runs = (JSON.parse(stdout) as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(runs)) throw new Error(`${url} gave no workflow_runs`);
  return runs as WorkflowRun[];
};

/** `abc1234 (2026-10-15 06:41 UTC)`. */
const when = (run: WorkflowRun) => `${run.head_sha.slice(0, 7)} (${run.created_at.slice(0, 16).replace('T', ' ')} UTC)`;

/** The first line of a thrown value's message. */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).trim().split('\n')[0];

/** How main's last full run went, for `x ci --status`: fails only when the last finished run did not pass. */
export async function mainStatus(slug: string | undefined, read: RunsReader): Promise<CommandResult> {
  const unknown = (why: string): CommandResult => ({
    ok: true,
    summary: `main's last full run is unknown: ${why}`,
    target: 'status',
    warnings: [
      {
        id: 'CI_STATUS_UNKNOWN',
        message: `main's last full run is unknown (${why}): read the workflow's runs on GitHub, or run node x ci --local --full`,
      },
    ],
  });
  if (!slug) return unknown('origin is not a GitHub repository');
  let runs: WorkflowRun[];
  try {
    runs = await read(slug);
  } catch (error) {
    return unknown(`GitHub's API did not answer: ${firstLine(error)}`);
  }
  const at = runs.findIndex(
    (run) => run.status === 'completed' && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped',
  );
  const going = runs.slice(0, at < 0 ? runs.length : at).filter((run) => run.status !== 'completed');
  const still = going.length ? `; ${going.length} newer still running, the latest on ${when(going[0])}` : '';
  if (at < 0) {
    if (!going.length) return unknown(`the workflow has not finished a run on main of ${slug}`);
    return { ok: true, summary: `main's first full run is still running${still}`, target: 'status' };
  }
  const last = runs[at];
  if (last.conclusion === 'success') {
    return { ok: true, summary: `main's last full run passed on ${when(last)}${still}`, target: 'status' };
  }
  const verdict = last.conclusion === 'failure' ? 'failed' : `ended ${last.conclusion ?? 'without a verdict'}`;
  const message = `main's last full run ${verdict} on ${when(last)}: fix it before other work (AGENTS.md); its job's log names the failing step and its out/ artifact holds the reports: ${last.html_url}`;
  return {
    ok: false,
    summary: `main's last full run ${verdict} on ${when(last)}${still}`,
    target: 'status',
    failures: [{ id: 'CI_MAIN_RED', message }],
  };
}
