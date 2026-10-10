@AGENTS.md

# Claude Code notes

- **DOCTRINE.md first**, then AGENTS.md (imported above). Change DOCTRINE.md only when the owner asks; from WP 0.10 a
  PreToolUse hook asks the owner to confirm each edit.
- **Session setup.** Run `bash scripts/setup.sh` once per session until the SessionStart hook does it (WP 0.10). With
  `$CLAUDE_ENV_FILE` set, it appends Node 24's `PATH` and the `MY3D2DGE_SRC` and `SHARDFALL_SRC` exports, so every
  later Bash call sees them. `node --version` should print v24.21.0. The owner can make Node 24 permanent through the
  environment's setup script (PLAN.md §11.5).
- **Cloud container.** Chromium 141 is at `/opt/pw-browsers/chromium` (`$CHROMIUM_PATH` when set); never run
  `playwright install`. Outbound HTTPS goes through the environment's proxy: never disable TLS verification. If the
  sources cannot be resolved, the session must include `michaelcrosato/my-3d2dge` and `michaelcrosato/shardfall`
  (shardfall is private): escalate once (PLAN.md §11.5).
- **Long suites** (`npm run e2e`, `node x ci --local`) run as background tasks. Read `out/**/report.json` instead of
  scrolling their output.
- **API questions** are answered by the pinned packages' own types and sources in `node_modules` (three.js's `src/`
  carries its JSDoc), never by memory of another release: `tsc` rejects a name the pinned release lacks.
- **Subagents** (WP 0.10): `verifier` reviews L-size WPs and every gate against DOCTRINE.md and the WP's Done-when
  list; `visual-reviewer` reads images and returns a JSON verdict.
- **Pushes, stage PRs, squash merges and branch deletions** need no approval (ADR-0021). Any other outward action
  is escalated first (AGENTS.md, "Escalate, don't stall").
