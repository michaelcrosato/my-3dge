---
id: ESC-0006
title: "WP 12.2's Done-when asks that at least 90% of mutants injected into engine/sim and engine/anim be caught. A full Stryker run over their 21,764 mutants takes 10 to 12 hours here, so the run tests a fixed 10% sample of their functions; the WP's 54 new tests, written against that sample's survivors, raised it from 74.15% to 94.40% (1,584 of 1,678). A fresh draw of another 5% (seed wp-12.2-fresh, 938 mutants) catches 81.24% in all: 92.0% of the 338 mutants it shares with the sample and 74.3% of the 580 it does not, as the whole stood (74.6% ± 4.2) before the WP. How should WP 12.2's 90% be read?"
status: open
principle: "Quality under the hood"
raised: 2026-10-25T08:19:11Z
deadline: 2026-10-25T08:34:11Z
run: cse_0195aNNV9M5vZfaBJKsynNUv
options:
  - "Read it on the fixed sample the run tests (94.40%, the run failing under 90%), record the fresh draw (81.24%; 74.3% outside the sample) in ADR-0025 amendment 43 and PLAN.md, and rotate the sample's seed a stage at a time so each stage raises a new tenth: WP 12.2 done, the rest of sim and anim the owner's open issue."
  - "Keep WP 12.2 open until a fresh draw holds 90%: rounds of tests against fresh samples (about 3,000 survivors over the whole at 74%), many hours, gate G13 waiting."
  - "Amend the Done-when to a sampled reading for the future: 90% on the run's fixed sample, with a fresh draw reported every stage and its score rising; WP 12.2 done now on that reading."
recommendation: 1
answer: null
call: null
commit: null
followUp: null
---

# ESC-0006: WP 12.2's Done-when asks that at least 90% of mutants injected into engine/sim and engine/anim be caught. A full Stryker run over their 21,764 mutants takes 10 to 12 hours here, so the run tests a fixed 10% sample of their functions; the WP's 54 new tests, written against that sample's survivors, raised it from 74.15% to 94.40% (1,584 of 1,678). A fresh draw of another 5% (seed wp-12.2-fresh, 938 mutants) catches 81.24% in all: 92.0% of the 338 mutants it shares with the sample and 74.3% of the 580 it does not, as the whole stood (74.6% ± 4.2) before the WP. How should WP 12.2's 90% be read?

The 90% over every mutant is out of reach this stage: about 3,000 survivors to kill at 74%, and each check of the whole takes 10 to 12 hours. The fixed sample is a held, repeatable gate that fails under 90%, a fresh draw measures the rest honestly, and rotating the seed raises the whole a tenth at a time.

## Options

1. Read it on the fixed sample the run tests (94.40%, the run failing under 90%), record the fresh draw (81.24%; 74.3% outside the sample) in ADR-0025 amendment 43 and PLAN.md, and rotate the sample's seed a stage at a time so each stage raises a new tenth: WP 12.2 done, the rest of sim and anim the owner's open issue. (recommended)
2. Keep WP 12.2 open until a fresh draw holds 90%: rounds of tests against fresh samples (about 3,000 survivors over the whole at 74%), many hours, gate G13 waiting.
3. Amend the Done-when to a sampled reading for the future: 90% on the run's fixed sample, with a fresh draw reported every stage and its score rising; WP 12.2 done now on that reading.

## Log

- 2026-10-25T08:19:11Z: opened, waiting until 2026-10-25T08:34:11Z (run cse_0195aNNV9M5vZfaBJKsynNUv).
