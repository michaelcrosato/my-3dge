# ADR-0021: The owner's calls of 2026-10-10

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §11.1, §8.14, WPs 0.12, 3.12, 8.10

## Decision
1. **Mobile and deployment, built now and not tested.** Touch controls modelled on shardfall's, its phone-ready page
   and its lighter defaults on phones (WP 3.12), and a Vercel deployment of every push (WP 0.12), are built ahead of
   Phase H. They get no specs, device emulation, phone runs, deployment tests or CI steps. A stage PR's Vercel status
   gets one look before merging, so a failed build is fixed when it shows (§11.1); that look is not a test. Anything
   else about them is fixed only when the owner reports it, and may then be reproduced by whatever it needs (touch
   emulation included) without adding a standing suite. The `verifier` does not flag their missing tests. This is an
   exception to the doctrines Verifiable and Discovery first, made by the owner.
2. **100STYLE** (CC BY 4.0) is adopted, with its credit (WP 8.10).
3. **Pre-approved outward actions:** pushes (at milestones, and the session's branch whenever that protects work),
   stage PRs squash-merged, their branches deleted, and the Vercel deployments that pushes trigger.

## Why
The owner's direction, given on 2026-10-10.

## Enforced by
AGENTS.md's rules; the `verifier`'s exception list; §8.14's pre-approved list.
