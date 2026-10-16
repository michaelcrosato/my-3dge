# Goal brief: the on-demand work packages, on the owner's order

The brief for a session the owner starts with `/goal` to build the 21 on-demand WPs ahead of their measured triggers:
5.6, 7.5, 7.6, 7.7, 8.8, 10.1–10.6, 10.8, 10.9, 11.1–11.5 and 12.1–12.3 (10.7 and 12.4 are done; Phase H is not
ordered; DOCTRINE.md does not change). The `/goal` prompt holds the owner's decisions; this brief holds what they mean
and how the goal runs. AGENTS.md, PLAN.md §9.3 and §11.1 apply throughout: this brief adds only what is specific to the
goal.

## 1. Before any work

1. `node x ci --status`: a red main is fixed first.
2. Read DOCTRINE.md, AGENTS.md, docs/PROGRESS.md, PLAN.md §9.1–§9.3, §11.1–§11.5, §14's header and the 21 rows, and
   ADR-0017, ADR-0018, ADR-0021 and ADR-0023 in docs/decisions/. Read each WP's entry, and only the sections it cites,
   when that WP starts.
3. Run mode: PLAN.md §11.2's extra-effort loop, one agent taking the WPs in sequence. The `verifier` and
   `visual-reviewer` subagents, the browser specs and the long runs keep the main context small (§11.2), and each WP's
   ledger row is updated in the same commit as its work (§11.1).

## 2. What each decision means

- **@modelcontextprotocol/sdk (7.6).** Refused: 7.6 is blocked; no MCP protocol is written by hand. Approved: a
  devDependency with what npm installs with it, pinned by PLAN.md §6.10's rule, its reason in tools/deps.json.
- **@stryker-mutator/core and @stryker-mutator/vitest-runner (12.2).** Refused: 12.2 builds the evals and its
  `--dry-run`, and the mutation half is blocked. Approved: as above, compatible with the pinned Vitest.
- **No other new dependency** is approved: one a WP needs is an escalation (AGENTS.md).
- **Quaternius UAL v2 GLBs (8.8).** Not supplied: 8.8 does everything that needs no GLB, and the Quaternius clips stay
  blocked in its ledger row. Supplied: imported from the owner's link, never committed.
- **Network fetches for 8.8** (Mesh2Motion over git, CMU over HTTP, 100STYLE by range requests). Allowed: into
  `.cache/` only, never committed. Not allowed: 8.8 uses only the sources already on disk.
- **Model access for 12.2's evals.** None: the dry run, with a deferred proof. Otherwise as the prompt names it.
- **Spending money:** no.

Escalations follow AGENTS.md: open one, wait up to 15 minutes doing the preferred alternative, then decide, record
and continue.

## 3. Commit 1: the waiver, before any WP code

The verifier fails work built ahead of its trigger (North Star), so the owner's order is recorded first, in one
commit:

1. ADR-0025 in docs/decisions/, in that directory's README format: "The owner's order of 2026-10-16: build the
   on-demand WPs now". It quotes the prompt's decisions, records the stages below as the PR batches and the
   owner-gated items, and says it is an exception to the North Star made by the owner, as ADR-0021 was, not a change
   to the doctrine.
2. ADR-0018 amendment 4, pointing at ADR-0025.
3. PLAN.md, in the same commit: each of the 21 trigger cells in §9.1 and each entry's **Trigger:** line gets "Fired
   2026-10-16 by the owner's order (ADR-0025)", as WP 10.7's does; §9.1 and §11.1 say the owner may order an on-demand
   WP, and the order is then its trigger; §2's "Nothing in anticipation" bullet, §9.3's trigger item and §14's status
   definition accept "the owner's order that waived it"; §11.2's on-demand row and §11.3's after-G7 line; §11.3's
   gates sentence runs "the specs for what only T2 checks that the stage touched; the full run goes on main after the
   merge (ADR-0023)" in place of the full `npm run e2e`; Appendix E's copy of AGENTS.md.
4. AGENTS.md: on-demand WPs "wait for their measured trigger or the owner's order (PLAN.md §9.1, ADR-0025)".
5. .claude/agents/verifier.md and PLAN.md's verifier prompt: "(ADR-0025's owner-ordered WPs aside)" after "work built
   ahead of its trigger". Agent definitions load at session start, so in this session every verifier call also says:
   "WP-x.y was built on the owner's order of 2026-10-16 (ADR-0025). Do not fail it as built ahead of its trigger; check
   that its ledger note records the waiver."

Every ledger note of the goal starts "Trigger waived by the owner's call (ADR-0018 amendment 4, ADR-0025)." and adds
the trigger's measurement where it is cheap (7.7: entries per kind; 12.1: kinds written by hand without a template;
11.4: draw calls at crowd-5000).

## 4. Stages

Each stage is one PR, its WPs taken in the order listed. Build a WP's unbuilt Needs first and keep to its Owns. A WP
whose Need is blocked is blocked too, naming the Need.

1. **Tooling:** 5.6, 7.6 (it needs 5.6), 7.5, 7.7. 5.6 decides how the `devAction` kind relates to
   scene `actions` (ADR-0006 amendment 4) with every replay golden unchanged, recorded as an ADR-0006 amendment. 7.5 is
   built against this container only.
2. **Expansions:** 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.9. If 10.1 is over
   L, split it into 10.1a, b and c, with their rows in §14 and their Owns in the entry. No game content in the engine
   (PLAN.md §5.7); box scenes stay in labs/box/. 10.8 builds on 7.7's gallery.
3. **GPU:** 11.1, 11.2, 11.3, 11.4, 11.5. 11.1 adds the `feature` template (ADR-0008
   amendment 1) and joins 7.5's governor; 11.5 lets the governor demote its features. Looks and speed only: no GPU
   result reaches the sim.
4. **Agent tooling and the re-import:** 8.8, 12.2, 12.3, then 12.1 last, once every other WP's kinds and hooks exist. Template
   tests run in the full run, not the quick gate (ADR-0023): say so in 12.1's Build and §8.13 as an ADR-0023
   amendment. 12.2's mutation run is a background task outside the quick gate. 8.8 starts with a skinned-mesh GLB
   import test whose fixture the test generates; no binary is committed.

U-1 (Vitest 4) qualifies on 2026-10-22: if the goal runs past it, it is a WP of its own between two stages, in its own
PR, and checks that the pinned Stryker runner supports Vitest 4 (if not, record the conflict and keep Vitest 3).

## 5. The gate at the end of each stage

Green, all of it:

- every WP's Done-when, each item proved or marked *(deferred proof: …)* in its ledger note;
- the stage's Verify commands, `npm run check`, `npm test` and the T2 specs for what the stage touched;
- `node x docs --write` then `node x docs --check`, with lean/, the guide and the starter kept true;
- `node x deps --qualify`;
- a verifier review of each L-size WP (8.8, 10.1, 11.4, 11.5) and of the stage's diff, every finding fixed or
  answered.

Then: rewrite docs/PROGRESS.md (40 lines at most) and write the gate note in §14; push and open the stage's PR with the
stage's `x film` and the box's numbers; squash-merge once `node x ci --local` is green on its head (Vercel is paused:
ignore it); start the next stage from the updated main; follow `node x ci --status` in the background until it shows
the merge's full run, and report it in the next gate note.

## 6. Rules specific to the goal

- A claim only real time can show: prove what counts can (draw calls, dispatches, instances) and mark the rest
  *(deferred proof: real-GPU timing, Phase H or the owner)* with an open issue starting "Owner:" (ADR-0022).
- The anim QA baseline entries that 10.2 and 8.8 retire change only with a written reason.
- A blocked WP gets the status `blocked` in §14, with the reason and the smallest unblocking change as a proposal;
  then the next WP starts.
