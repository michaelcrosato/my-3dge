---
id: ESC-0005
title: "WP 11.4's Done-when asks GPU-driven crowds for 2x better CPU render time at 5,000 people. Stage 1 (feature:gpuCrowds: a compute cull and an indirect draw a batch) halves the crowd's draw calls (34 to 16) with the hash unchanged, but leaves CPU render as it was (an interleaved A/B: 0.99): the frame's CPU is posing the seen bodies, writing about 103,000 instances and 13.9 MB of garbage a frame, not draw submission, and a cheap look at stage 2 (FK and pieces on the GPU) projects about 1.5x, still short of 2x. How should WP 11.4 close?"
status: open
principle: "Quality under the hood"
raised: 2026-10-25T06:12:42Z
deadline: 2026-10-25T06:27:42Z
run: cse_0195aNNV9M5vZfaBJKsynNUv
options:
  - "Take stage 1 as WP 11.4's result: its Done-when narrowed to the draw calls, and the crowd's CPU posing made an animation WP of its own (start: the animator's Object.entries garbage)"
  - "Build stage 2 (FK and pieces on the GPU), about 1.5x, still short of 2x"
  - "Keep WP 11.4 open until that animation work lands, then measure again"
recommendation: 1
answer: null
call: null
commit: null
followUp: null
---

# ESC-0005: WP 11.4's Done-when asks GPU-driven crowds for 2x better CPU render time at 5,000 people. Stage 1 (feature:gpuCrowds: a compute cull and an indirect draw a batch) halves the crowd's draw calls (34 to 16) with the hash unchanged, but leaves CPU render as it was (an interleaved A/B: 0.99): the frame's CPU is posing the seen bodies, writing about 103,000 instances and 13.9 MB of garbage a frame, not draw submission, and a cheap look at stage 2 (FK and pieces on the GPU) projects about 1.5x, still short of 2x. How should WP 11.4 close?

The measured cost is in the animation layer, which GPU drawing cannot remove; stage 1 is merged behind its feature either way, the hash unchanged

## Options

1. Take stage 1 as WP 11.4's result: its Done-when narrowed to the draw calls, and the crowd's CPU posing made an animation WP of its own (start: the animator's Object.entries garbage) (recommended)
2. Build stage 2 (FK and pieces on the GPU), about 1.5x, still short of 2x
3. Keep WP 11.4 open until that animation work lands, then measure again

## Log

- 2026-10-25T06:12:42Z: opened, waiting until 2026-10-25T06:27:42Z (run cse_0195aNNV9M5vZfaBJKsynNUv).
