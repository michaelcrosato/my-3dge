Add a fog preset to the Stress Box: a grey, overcast moor where thick fog closes in past the hero and lies low on the
floor, as a sky preset and a look that shows it, in `labs/box/looks/moor.ts` with its unit test beside it.

- The sky `sky:moor`: the background `#8a929a`; no sun; an ambient light from `#9aa4ae` above and `#3a3f44` below at
  intensity 1.4; fog of the colour `#a7afb7` and strength 0.9, the range fog starting 4 m past the focus and whole at
  40 m, and height fog 0.6 dense at the floor (height 0), gone 2 m up.
- The look `look:moor`: that sky over the scene's own style, with no filter. `node x set post.look look:moor` must
  switch to it.
