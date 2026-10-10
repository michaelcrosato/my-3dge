# Advice baselines

The advice codes and warnings a test may print. The advice trap (`tests/setup/adviceTrap.ts`, PLAN.md WP 0.5) fails
any test, in Vitest and in the e2e fixture, that prints an engine advice code, a `console.warn` or a three.js
deprecation that no file here lists. Its file comment has the exact rules.

- One file per area, `<area>.json`, owned by the WP that adds its entries (PLAN.md §9.3). The trap reads every
  `*.json` file in this directory.
- Each file is an array of `{ "code": "...", "reason": "..." }`, nothing else. `code` is an advice code
  (`GFX_NO_TIMESTAMP`, matched exactly) or, for a warning without one, a text its message contains.
- The reason says why the warning is expected where it appears. An entry changes only with a written reason
  (AGENTS.md), and listing is the last resort: first fix what prints it.
- A test that provokes a warning on purpose handles it instead of listing it: in Vitest it spies on the console, in
  an e2e spec it reads `harness.advice()`.
