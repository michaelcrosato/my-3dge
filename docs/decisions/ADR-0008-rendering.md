# ADR-0008: Rendering: WebGPU only

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.7, §3

## Decision
- WebGPU is the only renderer. It is required at startup (`GFX_NO_WEBGPU` without it); three.js's WebGL 2 fallback
  is switched off.
- Everything WebGPU offers, compute included, serves looks and speed, never play.
- Materials are data with familiar parameters, drawn inside the renderer by whatever looks best (TSL, compute, the
  addons).
- Game UI is HTML/CSS over the canvas.
- Gameplay runs only on the CPU: sim-side code never imports the renderer, `gfx/`, the DOM or Web Audio, and nothing
  is read back from the GPU into the sim (§6.7).
- Optional GPU features arrive on demand. One fixed MRT set is created at startup, with every filter gated by a
  uniform (§6.7).

## Why
Doctrine WebGPU only. Keeping play on the CPU keeps it reproducible and headless (doctrines: Reproducible,
Verifiable).

## Enforced by
ESLint's layer rules; `tests/e2e/parity.spec.ts` (rendering never changes the hash); the startup test without WebGPU.
