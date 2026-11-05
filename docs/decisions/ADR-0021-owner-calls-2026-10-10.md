# ADR-0021: The owner's calls of 2026-10-10

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §11.1, §8.14, WPs 0.12, 3.12, 8.10

## Decision
1. **Mobile and deployment, built now and not tested.** Touch controls modelled on shardfall's, its phone-ready page
   and its lighter defaults on phones (WP 3.12), and a Vercel deployment of every push (WP 0.12), are built ahead of
   Phase H. They get no specs, device emulation, phone runs, deployment tests or CI steps. A stage PR's Vercel status
   gets one look before merging, so a failed build is fixed when it shows (§11.1); that look is not a test. Anything
   else about them is fixed only when the owner reports it, and may then be reproduced by whatever it needs (touch
   emulation included) without adding a standing suite. The `verifier` does not flag their missing tests. This is an
   exception to the doctrines Verifiable and Discovery first, made by the owner.
2. **100STYLE** (CC BY 4.0) is adopted, with its credit (WP 8.10).
3. **Pre-approved outward actions:** pushes (at milestones, and the session's branch whenever that protects work),
   stage PRs squash-merged, their branches deleted, and the Vercel deployments that pushes trigger.

## Why
The owner's direction, given on 2026-10-10.

## Enforced by
AGENTS.md's rules; the `verifier`'s exception list; §8.14's pre-approved list.

## Amendment 1 (2026-10-10, WP-3.12): touch buttons that act while held, and the page's conventions
- A `touchlayout` button takes `{ action, label?, hold? }`. With `hold`, the button acts as shardfall's skills do: a
  tap presses once on release, and a hold (0.32 s and two frames) holds the action. Without it, a button acts the
  moment it is touched and stays held while the finger stays.
- Pages mark what the touch layer reads:
  - `data-panel`: a panel, open while it has no `hidden` attribute. A tap on the game hides the top one and
    dispatches `close`.
  - `data-keyboard` and `data-stats`: hidden in touch mode.
  - `data-hud`: text scaled by `--touch-k`.
  - The menu button is `data-tap="menu"`.
- Taps and holds are timed by the frame timestamps passed to `input.sample(camera, now)`, so the tools' virtual clock
  drives them.
- `keepWidth` (the portrait lens) applies to any picture taller than wide, as in shardfall, not only on touch screens.
- PLAN.md's WP-3.12 Buttons bullet is edited to match.

## Amendment 2 (2026-10-27): what Vercel deploys

Decision 1's "a Vercel deployment of every push", and its look at a stage PR's Vercel status, give way to ADR-0023
amendment 4 (the owner's direction of 2026-10-27, to keep Vercel's cost down): production deploys a merge to `main`
that changes what ships, a branch builds a preview only when asked (`[preview]`), and the look is at main's
production deployment after such a merge, or at a preview a stage that changes the build asks for. Nothing more is
tested.

## Amendment 3 (2026-10-27): the landing page opens the playground

The owner, opening the production site (my-3dge.vercel.app), found only the Stress Box, which the landing page
(`index.html`, WP 0.12) had opened since WP 2.7: the playground, where the owner plays the tech demo and works the
Owner checks (WP 13.28), was reachable only by its path. The landing page now opens `labs/playground/`, passing on the
URL's query and hash as before, and the playground's menu for humans links the other pages: the labs index
(`labs/index/`, every page and lab) and the Stress Box (`labs/box/`). The box's own routes (`labs/box/?scene=…`) are
unchanged; `/?scene=…` now names a playground scene. tests/e2e/playground.spec.ts checks the landing page and the
menu's links; the box's spec opens the box at its own path. PLAN.md's WP 0.12 bullet, its layout and I-53 are edited
to match. The menu's links went with the menu (ADR-0025 amendment 51, 2026-11-04): the labs index and the box open at
their own paths, the game reaching them only from the owner checks `labs` and `esc-0005`.

## Amendment 4 (2026-11-02): no deployment

The owner's call of 2026-11-02 ends the Vercel deployment (decision 1, amendment 2) and its pre-approval (decision 3):
the engine is distributed and tested as `playground.html`, the playground as one self-contained page that the quick
gate keeps current (ADR-0023 amendment 5). The touch controls stay built and untested, as decision 1 has them.
Amendment 3's landing page stays for the dev server and `npx vite preview`; what the owner opens is the file.

## Amendment 5 (2026-11-05, WP-13.44): the right thumb turns the view

The owner, playing `playground.html` on a phone (a Galaxy S25, in Chrome), found no way to turn: the first finger on
the game was the stick and any other could only tap. They asked for the left thumb to move the feet and the right one
to turn the torso and head. Now the first finger on the game's left half is the stick, and any other finger on the
game turns the view as the mouse does under pointer lock: `TOUCH_LOOK` (2) mouse counts a CSS px, added to the mouse's
before the view settings `input.*` scale them (engine/input/devices/touch.ts `takeLook`, engine/input/input.ts), so
a drag across half a phone held sideways turns the view about 90° at the default sensitivity. A short still touch is
still a tap on the game. The controls sheet names both thumbs on touch, and the touch check asks about the drag.
Reproduced once under emulated touch, as decision 1 allows, with no standing suite: a 200 px drag turned the shooter's
view 44° and a 40 px rise raised it 8.8°, and the stick walked the player 4.9 m without turning it.
