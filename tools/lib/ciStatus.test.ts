/**
 * @file Unit tests for main's full-run status (tools/lib/ciStatus.ts), with a fake GitHub: the slug from https, ssh
 * and git-proxy remotes; passed, failed, timed out, cancelled (red: the workflow cancels none), skipped (passed over)
 * and still running; and unknown, never a failure, without a GitHub origin, without an answer or without a finished
 * run.
 */
import { describe, expect, it } from 'vitest';
import { mainStatus, repoSlug, type RunsReader, type WorkflowRun } from './ciStatus';

const SHA = 'c0ffee'.padEnd(40, '0');
const NEWER = 'beef'.padEnd(40, '0');

/** A run on main, as GitHub's API gives it. */
const run = (status: string, conclusion: string | null, sha = SHA): WorkflowRun => ({
  status,
  conclusion,
  head_sha: sha,
  html_url: `https://github.com/o/r/actions/runs/${sha.slice(0, 4)}`,
  created_at: '2026-10-15T06:41:15Z',
});
/** A fake GitHub that answers `runs`, newest first. */
const answers =
  (...runs: WorkflowRun[]): RunsReader =>
  async () =>
    runs;

describe('repoSlug', () => {
  it('reads owner/repo from https, ssh and git-proxy remotes, and nothing else', () => {
    expect(repoSlug('https://github.com/michaelcrosato/my-3dge')).toBe('michaelcrosato/my-3dge');
    expect(repoSlug('https://github.com/michaelcrosato/my-3dge.git')).toBe('michaelcrosato/my-3dge');
    expect(repoSlug('git@github.com:michaelcrosato/my-3dge.git')).toBe('michaelcrosato/my-3dge');
    expect(repoSlug('http://local_proxy@127.0.0.1:41625/git/michaelcrosato/my-3dge')).toBe('michaelcrosato/my-3dge');
    expect(repoSlug('https://gitlab.com/a/b.git')).toBeUndefined();
    expect(repoSlug(undefined)).toBeUndefined();
  });
});

describe('mainStatus', () => {
  it('passes when the last finished run passed, naming any newer run still going', async () => {
    expect(await mainStatus('o/r', answers(run('completed', 'success')))).toMatchObject({
      ok: true,
      summary: "main's last full run passed on c0ffee0 (2026-10-15 06:41 UTC)",
      target: 'status',
    });
    const going = await mainStatus('o/r', answers(run('queued', null, NEWER), run('completed', 'success')));
    expect(going.summary).toBe(
      "main's last full run passed on c0ffee0 (2026-10-15 06:41 UTC); 1 newer still running, the latest on beef000 (2026-10-15 06:41 UTC)",
    );
  });

  it('fails when the last finished run failed, timed out or was cancelled, and passes over skipped runs', async () => {
    const red = await mainStatus('o/r', answers(run('completed', 'skipped', NEWER), run('completed', 'failure')));
    expect(red.ok).toBe(false);
    expect(red.summary).toBe("main's last full run failed on c0ffee0 (2026-10-15 06:41 UTC)");
    expect(red.failures?.[0].id).toBe('CI_MAIN_RED');
    expect(red.failures?.[0].message).toContain('fix it before other work (AGENTS.md)');
    expect(red.failures?.[0].message).toContain('https://github.com/o/r/actions/runs/c0ff');
    const late = await mainStatus('o/r', answers(run('completed', 'timed_out')));
    expect(late).toMatchObject({ ok: false, summary: "main's last full run ended timed_out on c0ffee0 (2026-10-15 06:41 UTC)" }); // prettier-ignore
    const stopped = await mainStatus('o/r', answers(run('completed', 'cancelled', NEWER), run('completed', 'success')));
    expect(stopped).toMatchObject({
      ok: false,
      summary: "main's last full run was cancelled (the time limit, or by hand) on beef000 (2026-10-15 06:41 UTC)",
    });
    expect(stopped.failures?.[0].message).toContain('make the slow step fit, .github/workflows/ci.yml');
  });

  it("is unknown and passes without a GitHub origin, without GitHub's answer or before any run finished", async () => {
    const none = await mainStatus(undefined, answers());
    expect(none).toMatchObject({ ok: true, summary: "main's last full run is unknown: origin is not a GitHub repository" }); // prettier-ignore
    expect(none.warnings?.[0].id).toBe('CI_STATUS_UNKNOWN');
    const offline = await mainStatus('o/r', async () => {
      throw new Error('curl: (7) Failed to connect\nmore');
    });
    expect(offline).toMatchObject({
      ok: true,
      summary: "main's last full run is unknown: GitHub's API did not answer: curl: (7) Failed to connect",
    });
    expect((await mainStatus('o/r', answers())).summary).toBe(
      "main's last full run is unknown: the workflow has not finished a run on main of o/r",
    );
    expect(await mainStatus('o/r', answers(run('in_progress', null)))).toMatchObject({
      ok: true,
      summary:
        "main's first full run is still running; 1 newer still running, the latest on c0ffee0 (2026-10-15 06:41 UTC)",
    });
  });
});
