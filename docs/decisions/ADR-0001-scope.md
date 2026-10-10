# ADR-0001: Scope: the engine only

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §2, §5.7, §9.0

## Decision
- This repository builds the engine only. The game is built later, elsewhere (§13.2 Q4: a separate repository or
  `games/<name>` package that imports the engine as a pinned git submodule).
- The Stress Box (§9.0) is the integration target, the benchmark and the sample, not a game. Its monsters, waves and
  numbers are sample content and stay in `labs/box/`.
- Emberdeep's engine-grade patterns (registries with schemas, the event bus, rig checks, the tuning registry…) are
  rebuilt generically, with new minimal fixtures, when the box, Phases 8–9 or an on-demand WP needs them (§5.6). Its
  content is excluded and never remade (§5.7).

## Why
The owner's intent (§2): an engine on which agents produce reliable, consistent, token-efficient output, plus tools
reused across games. A game inside the engine repository would couple the two and blur the public API.

## Enforced by
The roadmap (§9) and the exclusion list (§5.7); the `verifier` reviews diffs against `DOCTRINE.md` and the WP's
Done-when list; AGENTS.md's rule "no game content in the engine".
