# Baselines

What the tests compare against: accepted exceptions and recorded numbers, never images. A baseline changes only with
a written reason (AGENTS.md), and each file belongs to the WP that creates it (PLAN.md §9.3).

- `qa-<family>.json`, `qa-<family>-<area>.json`: the accepted content-QA exceptions for `node x qa`, each
  `{ id, metric, value, reason }`. tools/cmd/qa.ts's file comment has the rules.
- `advice/<area>.json`: the advice codes and warnings a test may see (WP 0.5).
- `perf/<scene>.json`, `thumbs/<case>.json`: performance budgets and text thumbnails, from the WPs that record them.
- `port/`: the reference vectors from my-3d2dge that the ports are tested against (WP 0.11), written and checksummed by `node x port refs`; its README says what each file holds.
