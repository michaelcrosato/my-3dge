# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Where things stand (2026-10-12, gate G9 done: audio)

The plan's phases 0–9 are done: the foundation, the kernel, Boxes 1–6, the animation library and audio (PR #2–#11).
- DSP (engine/audio/dsp): every sound renders to one hash in Node and Chromium (20 reference + 200 random sounds).
- Sound data: kinds sfx and song; 33 effects, 6 drums and 5 songs from my-3d2dge, 44 goldens, templates sfx/song.
- Runtime: locked until a gesture, mixer buses with ducking, HRTF panning, occlusion by QueryView ray, procedural
  room reverb (RT60 within 5%), music layers by intensity, stingers on beats, sections on bar lines.
- Tools: the audio QA family (0 violations, empty baseline) and `x audio` (metrics, --wav, --spectrogram, --replay).
- The box sounds from its sim events: the fight's sound timeline hashes 8da39df56b106f5f in Node and Chromium;
  the page plays it with music, torches and the room's reverb (box-audio.spec.ts).
- Gate: `node x ci --local` green at 8573abe (check 6.2 s, test 31.5 s with 3,262 tests); T2 in full at the review,
  151/151 in 11 min 16 s; `x deps --qualify`: nothing qualifies beyond the pins.
- Since G9: typescript-eslint 8.71.2 adopted; the box's menu for humans (labs/box/menu.ts: scenes, cameras, looks,
  replays, controls) is in, and remembers being closed.

## What is next

- The plan's phases are complete. Everything else is on demand: each WP waits for its measured trigger
  (PLAN.md §9.1), WP 8.8 (re-import from the sources) among them; upgrades go in when they qualify (U-1 Vitest 4
  qualifies 2026-10-22).
- Owner: handing the engine to an agent, and the box against stress-world: docs/HANDOFF.md. U-1 also clears the
  4 Dependabot alerts (dev-only vitest and tinypool).

## Open issues

- T2 runs over its 9 min, a warning only (ADR-0022): the gate selects T2 in full while it is over.
- `x audio --replay` finds 0 box sounds: the box's sound map is page-side (needs a registry hook for a game's map).
- 17 files are over the 400-line warning (cap 600), none over the cap: `npm run lint` lists them (max-lines).
- The crowd's batches draw no flinch lean; at 1,000 agents the crowd blocks the stairs' foot.
- The post-IK foot plant (WP 6.2) and preciseHits Node/Chromium parity (WP 6.1) are open.
- ESC-0001 (GitHub Actions) was decided in the owner's absence: Actions off, `x ci --local` is the gate.
- Not verified: speakers/headphones, Firefox/Safari audio, touch (ADR-0021), physical pads, real-GPU performance.
