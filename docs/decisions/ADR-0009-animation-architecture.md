# ADR-0009: Animation architecture

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §4.2, §5.2, §6.4, WPs 3.4–3.7

## Decision
- Poses are authored in effector space, solved by IK, and applied to a rotation skeleton: a root plus 23 joints.
- An explicit layer stack.
- Two update paths (§6.4): `anim.step` runs in the sim for every character, every tick, and is part of the gameplay
  hash; `anim.pose` runs in the presentation for characters that are drawn, may be LOD'd, and is not hashed. A
  character marked `preciseHits` has its pose evaluated in the sim, never depending on visibility.
- No Card mode (sprite characters; §13.2 Q7).
- The camera never feeds animation.

## Why
The prototype's animation core is costly to rebuild and works (§4.2): porting its math onto one skeleton and an
explicit layer model keeps what works. Splitting the update paths removes the prototype's leak where the visibility
set drove animation (doctrine: Reproducible).

## Enforced by
Differential tests against the ported reference vectors (WP 0.11); the animation QA checks and sheets (WP 6.6).
