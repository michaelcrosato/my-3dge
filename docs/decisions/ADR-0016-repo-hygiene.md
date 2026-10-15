# ADR-0016: Repo hygiene

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §11.1, I-32

## Decision
- No committed build output: `out/`, `dist/`, `.cache/`, `node_modules/` and `test-results/` are ignored.
- A lockfile (`package-lock.json`) and `npm ci`.
- The version lives in `package.json` only.
- `x ci --local` is the merge gate until GitHub Actions is enabled (§8.9).
- Pushes at milestones; one PR per stage, squash-merged (the only method the repository allows), its branch deleted
  (ADR-0021).

## Why
In my-3d2dge, 136 of 301 files were build output, and a version bump touched 10 places (I-32).

## Enforced by
`.gitignore`; `npm ci` in `scripts/setup.sh`; `x ci --local` (WP 0.9).

## Amendment 1 (2026-10-14, after G9, WP-0.9): GitHub Actions runs `x ci --local`
- **ESC-0001 answered yes** (the owner's decision 1 of 2026-10-14: Actions is on, the repository and both sources are
  public, so runner minutes are free and the sources clone with no secret). `.github/workflows/ci.yml` runs on pull
  requests, pushes to main and by hand, within 120 minutes, one job on ubuntu-24.04: it checks out my-3dge and both
  read-only sources at their pinned commits (with the job's read-only token, no secret, LFS off), takes Node from
  `.nvmrc`, runs `scripts/setup.sh` (its Chrome for Testing is tools/deps.json's Chromium, 141.0.7390.37, checked by
  `--version`) and Playwright's system libraries, then `node x ci --local`: the same seven steps (`CI_STEPS`), T2 in
  full on a fresh runner. It writes out/ci/summary.md to the step summary and to the job's log (GitHub's API serves an
  agent the log, not the step summary; added after the first run, whose failure only the summary named) and uploads
  `out/**`, always; a new push to a pull request cancels its run in progress, never one on main. The actions follow
  §6.10's rule: actions/checkout v5 (v5.0.0, 2025-08-11), actions/setup-node v6 (v6.0.0, 2025-10-14) and
  actions/upload-artifact v4 (v4.6.2, 2025-03-19).
  The newer majors (upload-artifact v5 and v6, checkout v6) are not taken under rule 3: whether they work the same way
  only a run of theirs would show, so they wait for their dates (upload-artifact v5 on 2026-10-24, checkout v6 on
  2026-11-20).
- **Not the Playwright container** that §8.9 planned (CLEANUP 8.2 allowed either): the runner is built as a fresh
  machine is, by the platform's own script, so the workflow tests the install path the docs give (§8.9 edited).
- **Kept equal** by tools/cmd/ci-workflow.test.ts, which reads the file as text (no YAML dependency): its gate is
  `node x ci --local` and no step runs a `CI_STEPS` command of its own; its commits are `sourceSpecs()`'s; Node comes
  from `.nvmrc`; its Chromium is tools/deps.json's, scripts/setup.sh's and tools/lib/browser.ts's.
- Until the workflow's first green run, `x ci --local` stays the merge gate.
