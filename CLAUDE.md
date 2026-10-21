@AGENTS.md

# Claude Code notes

- `node --version` should print v24.22.1 (the SessionStart hook puts it first on PATH); if not, run
  `bash scripts/setup.sh`.
- **Cloud container.** Chromium 141 is at `/opt/pw-browsers/chromium` (`$CHROMIUM_PATH` when set); never run
  `playwright install`. Never disable TLS verification for the environment's proxy. If the sources cannot be
  resolved, the session must reach GitHub (both are public) or include `michaelcrosato/my-3d2dge` and
  `michaelcrosato/shardfall`: escalate once (PLAN.md §11.5).
- **Long suites** (`npm run e2e`, `node x ci --local --full`) run as background tasks, and only where AGENTS.md
  allows them (ADR-0023). Read `out/**/report.json` instead of scrolling their output.
- **API questions** are answered by the pinned packages' own types and sources in `node_modules` (three.js's `src/`
  carries its JSDoc), never by memory of another release: `tsc` rejects a name the pinned release lacks.
