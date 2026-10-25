Add a prop to the Stress Box: `prop:waystone`, a stone that marks the box's paths, in `labs/box/props/waystone.ts`
with its unit test beside it.

- It stands 1.4 m tall: a square stone pillar (the material `material:stone`), 0.4 m wide at its foot and 0.3 m wide
  at its top, under a glowing rune cap (`material:glow`).
- The cap lights the floor round it with a steady cold light: colour `#7fd4ff`, intensity 2, reaching 5 m, shining
  from just above the cap, with no flicker.
- It is fixed: bodies stop against it and nothing knocks it over.
- A level places it on its spawn `waystone`.

Its parts must build clean, and the geometry and texture QA must pass for it.
