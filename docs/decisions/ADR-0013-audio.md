# ADR-0013: Audio: pure DSP, Web Audio for playback

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, Phase 9

## Decision
- Sounds are pure DSP from data into seeded, hashed `Float32Array`s.
- Web Audio plays them, spatial sound included.
- `OfflineAudioContext` is used only for smoke tests.

## Why
Doctrines Assets and Verifiable: no sound files, and every sound renders and checks headless in Node by its hash.

## Enforced by
The DSP tests and hashes (WP 9.1); the asset scan.
