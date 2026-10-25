A regression slipped into the engine's level compiler: the doors and windows of a level with storeys no longer know
the rooms on either side of them, and the compiler's unit tests fail (`npx vitest run engine/world/level`).

The tests and their golden hashes are right. Find the regression in the engine and fix it there, without changing any
test, golden or fixture.
