Add a building with rooms to the playground: `level:cabin`, a log cabin of two rooms, as a level with storeys
(level format 2) in `labs/playground/levels/cabin.ts`, with its unit test beside it.

- It is 7 × 4 m outside on 0.5 m tiles, its walls one tile thick, one storey 2.6 m clear under a flat roof.
- Its main room, `room:cabin`, is 4 × 3 m inside its walls, with the door in from the outside (1 m wide) in its south
  wall and a window in its west wall.
- The bunk room, `room:bunks`, 1.5 × 3 m, lies east of the main room, through a door 1 m wide in the wall between
  them.
- It validates clean: every room reachable, its doors wide enough, headroom where the player stands.

It stands on no site yet: `getLevel('level:cabin')` compiles it.
