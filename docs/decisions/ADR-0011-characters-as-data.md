# ADR-0011: Characters as data

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §13.2 Q6, WPs 3.6, 3.8, 5.4

## Decision
- Characters are data, described by body grammar v2.
- One rigid-skinned merged mesh per character by default; smooth skinning is optional, per body.
- Crowds are instanced.

## Why
Doctrines Assets and Agent-readable: a character an agent can read and edit as data, drawn cheaply enough for a crowd
of 5,000 (§9.0).

## Enforced by
Body and rig checks (content QA, §8.6); the crowd performance ladder (WP 5.5).
