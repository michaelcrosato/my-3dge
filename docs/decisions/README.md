# Decisions (ADRs)

Each `ADR-NNNN-<slug>.md` records one decision of PLAN.md §13.1: what was decided, why, and what enforces it. The
plan's sections hold the detail; an ADR points at them instead of restating them.

- **Format:** a title line `# ADR-NNNN: <decision>`, a status line (`accepted` or `superseded by ADR-NNNN`, the date,
  the plan sections it records), then **Decision**, **Why** and **Enforced by**, one page or less.
- **Amendments** (PLAN.md §11.4). When something is not as the plan says, measure, choose what best keeps the doctrine,
  and append `## Amendment N (YYYY-MM-DD, WP-x.y)` to the ADR it touches, with the evidence. Edit the affected WP
  entries of PLAN.md in the same commit. A decision that replaces an ADR outright is a new ADR, and the old one's
  status names it.
- **What needs the owner** (a binary asset, a new dependency, an outward action, a principle that cannot be met) is
  escalated first (PLAN.md §8.14, `docs/escalations/`), and the ADR records the answer or the call made in the
  owner's absence.
- `DOCTRINE.md` outranks every ADR. An ADR never amends the doctrine.
