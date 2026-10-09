# Agent-First Game Engine: Doctrine

## North Star

Build a game engine designed from the ground up for AI coding agents ("agents"). Every layer is built so agents can develop, test, inspect, and debug it directly. We deliberately leave behind human-centric development tooling and any method agents cannot use well. The result: games built faster, more consistently, and at higher quality than with general-purpose engines retrofitted for agents.

Analogy: a fully autonomous fighter jet with no cockpit. Removing the pilot removes the constraints a human imposes on the design. Humans give direction remotely; agents fly the plane.

## Principles

1. Agent-readable
   Code, data, and project structure are optimized for agent comprehension over human convention.

2. Agent-operable
   Every engine capability is exposed through machine interfaces. Nothing requires a GUI.

3. Verifiable without a display
   Everything can be run, tested, inspected, and verified without a screen or a human watching.

4. Agent-accessible assets
   Source assets are created in this order of preference:
   1. Procedural: code and data that generate the asset.
   2. Text/data: formats agents read and edit directly.
   3. Binary: only with human approval. Approved: fonts (WOFF2, TTF, OTF).

   Rationale: agents work best with code and data, and are improving at that faster than legacy asset tools are improving for agents.

5. Reproducible on the development platform
   On a given platform, identical inputs and seeds produce identical gameplay state, and any game state can be captured, restored, and replayed. Exact parity across browsers, operating systems, and hardware is not required.

6. Gameplay never depends on the GPU
   WebGPU is the primary renderer. WebGL2 is the fallback, for players without WebGPU and for agents without a GPU. GPU work, including WebGPU compute, may change how the game looks and performs, never how it behaves. Renderers need not look or perform the same, but must play the same.

7. Mastery over novelty
   Use the newest version that is at least 12 months old, so agents know it deeply. A newer version is acceptable when it is backward compatible with a qualifying version or otherwise works the same way, so agents' existing knowledge still applies. Upgrade as newer versions qualify. It is better to be really good with an older version, knowing all its tricks and optimizations, than to just get by with the newest.

8. Discovery first, hardening later
   Development and testing target the platform the development environment runs on. Cross-platform compatibility and hardening happen when a game goes to production.

   Rationale: most of the work is finding something worth shipping.

## Escalation

When an action requires human approval or a principle cannot be satisfied, escalate and wait. If there is no response within 15 minutes, commit current work, make the call, and continue. For the rest of that run, report further conflicts in chat without stopping. Record every escalation and every call made in its absence, so each can be found and reviewed.

Rationale: progress never stalls indefinitely. The worst case is a review, a change, or a rollback.
