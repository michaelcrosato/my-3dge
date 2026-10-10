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

## Amendment 1 (2026-10-10, WP-3.4)
- **The old rig's `footL`/`footR` is the sole, not the ankle.** Its drawing puts the ankle 62% of the way from the
  knee to the foot point. So build `legLower` is knee to sole, the `foot` joint (the ankle) sits `ankleHeight` above
  the sole, and the rest pose stands the soles at y = 0. WP 3.6 compares the old `footL` with the point on the sole
  under the ankle (contact height), not with the `foot` joint. Appendix C's joint table notes it.
- **Public names.** `anim.sheet()` and `anim.check()` are exported as `animSheet` and `animCheck`: sim-api takes flat
  names.
- **Build fields.** Builds hold `hipHeight` (was `hipZ`) and `headRadius` (was `headR`), since Z is no longer up, plus
  the stance and gait fields, so locomotion (WP 3.6) reads them from the entry. Four fields are new, with chosen
  defaults rather than source values (the old rig had no ankles, hands or back): `ankleHeight`, `footLength`,
  `handLength`, `chestDepth`; WP 3.8 should review them once bodies are drawn.
- **No `skeleton` registry kind** until a second skeleton exists; builds are registry kind `build`.
- Evidence: `engine/anim/fk.test.ts` (4 builds at sizes 1 and 0.5, soles at y = 0, three.js `Bone` hierarchy within
  1e-9 m).
