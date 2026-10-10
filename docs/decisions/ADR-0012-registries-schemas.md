# ADR-0012: Registries and schemas

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.6, §8.13

## Decision
- "Ask the entry, never the id": shared code reads a registry entry's hooks and never compares ids.
- Every kind gets an `x describe` listing (also `__engine.describe()`) and docs.
- Scaffold templates (`x new`) arrive with use: the WP that writes a kind's third entry by hand adds its template
  (§8.13). `gallery` hooks arrive with the gallery (on demand).
- Kinds with a QA family get its checks (§8.6).

## Why
Doctrines Agent-readable and Agent-operable: content is data, discoverable and checkable by machine, and extended by
adding entries rather than editing shared code.

## Enforced by
Schema validation in the registry (WP 1.2); `x describe`; the QA families; AGENTS.md's rule.
