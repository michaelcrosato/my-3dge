---
id: ESC-0007
title: "Your direction was all the demo stuff on one map. The playground's demos are all on the block now, but the engine's own Stress Box (crowds of 100 to 5,000, a 1,000-agent fight, prop halls, ragdolls, the clip library) and its seven labs (Animation, Materials, Props, Effects, Cameras, Physics, Library) are separate pages, reached from Tools. Should they stay separate, or come onto the block?"
status: answered
principle: Escalation
raised: 2026-11-05T01:01:42Z
deadline: 2026-11-05T01:16:42Z
run: cse_014hPugipWMVPYbbcNUuPgZ1
options:
  - "Keep them as the engine's own tools beside the block: Tools names them and its links work from playground.html (they need the dev server), the block holding every playground demo (ADR-0025 amendment 51's call)"
  - "Bring them onto the block as places Go to and the area cards know: a crowd yard (100, 1,000 or 5,000 walkers), a prop hall to shove props in, an animation stage with the clip library, and a gallery of materials and effects"
recommendation: 1
answer: "Option 1, beside the block (the owner in the session's chat, 2026-11-05): the Stress Box and the seven labs stay separate pages opened from Tools, their links made to work from playground.html."
call: null
commit: null
followUp: null
---

# ESC-0007: Your direction was all the demo stuff on one map. The playground's demos are all on the block now, but the engine's own Stress Box (crowds of 100 to 5,000, a 1,000-agent fight, prop halls, ragdolls, the clip library) and its seven labs (Animation, Materials, Props, Effects, Cameras, Physics, Library) are separate pages, reached from Tools. Should they stay separate, or come onto the block?

The box and the labs test the engine at scales and in isolation the block cannot (5,000 agents, every clip, one material at a time); on the block they would weigh on every frame of play. Their links are fixed either way.

## Options

1. Keep them as the engine's own tools beside the block: Tools names them and its links work from playground.html (they need the dev server), the block holding every playground demo (ADR-0025 amendment 51's call) (recommended)
2. Bring them onto the block as places Go to and the area cards know: a crowd yard (100, 1,000 or 5,000 walkers), a prop hall to shove props in, an animation stage with the clip library, and a gallery of materials and effects

## Log

- 2026-11-05T01:01:42Z: opened, waiting until 2026-11-05T01:16:42Z (run cse_014hPugipWMVPYbbcNUuPgZ1).
- 2026-11-05T01:03:15Z: answered by the owner: Option 1, beside the block (the owner in the session's chat, 2026-11-05): the Stress Box and the seven labs stay separate pages opened from Tools, their links made to work from playground.html.
