/**
 * @file The playground's look for its UI (docs/PLAYGROUND.md §8.3; the owner's call of 2026-11-03, "a UI that looks
 * decent"): one stylesheet, added once (`installTheme`), that every screen of the front end (labs/playground/ui/
 * frontEnd.ts), its panels (settings, Go to, Tune, the owner's checks, photo mode, the controls), the splash screen
 * (splash.ts), the HUD (hud.ts), the area card (areas.ts), the tour's banner (attract.ts), the world's signs and the
 * feel panel (labs/playground/feel.ts) wear, none of them with a sheet of its own. The engine's widgets and its feel
 * panel keep their own stylesheets (engine/ui/widgets.ts, engine/dev/feel/panel.ts) for every other page; here
 * everything but the feel panel sits under the overlay's `pg-ui` class, so this sheet wins without touching the
 * engine; the feel panel, a child of the body beside the overlay, has a block of its own (`body > .feel-panel`: one
 * element more than the engine panel's selectors, so it wins whichever sheet comes first).
 *
 * The look: dark glass panels over the world (a blurred, dimmed backdrop), one warm accent (`--pg-accent`) for what is
 * selected, the title in heavy capitals, large type a player reads at a glance, form controls drawn alike in every
 * browser, the focused one outlined in the accent (a pad walks them: walk.ts). Layers, low to high: the world's labels
 * (the gym's signs), the HUD (the crosshair and the damage numbers too), the area card and the feel panel, all hidden
 * under a screen (under the Tune panel, at the side so the world shows, the HUD with its crosshair and damage numbers
 * stays); a screen and its panels, scrolling where the window is too short for them (in windows 720 px tall or less the
 * start menu's brand and the items shrink, and at 460 px or less the detail line under a menu goes; the splash keeps
 * its own); the touch buttons, hidden under a screen or photo mode but for the menu button; the splash. The palette
 * (`--pg-glass`, `--pg-line`, `--pg-text`, `--pg-dim`, `--pg-accent`, `--pg-good`), the radius, the shadow and the font
 * are custom properties on `.pg-ui`, `.pg-splash` and `.feel-panel`; the type sizes and the backdrops' shades are
 * written where they are used.
 *
 * Invariants: presentation only; one `<style id="pg-theme">` in the page however often it is called, moved after the
 * engine's sheets each time (so it wins their ties whether the splash or the engine came first); it names no element
 * the tests read (they read `[data-ui]`, never classes).
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // installTheme(document); engine.ui.root.classList.add('pg-ui');
 * @see tests/e2e/playground-ui.spec.ts
 */

/** The stylesheet's id: one in the page. */
const THEME_ID = 'pg-theme';

/** The theme's stylesheet (see the file comment). */
const THEME_CSS = `
.pg-ui, .pg-splash, .feel-panel {
  --pg-glass: rgba(13, 16, 23, 0.84); --pg-glass-strong: rgba(10, 12, 18, 0.94); --pg-line: rgba(255, 255, 255, 0.1);
  --pg-text: #eef1f6; --pg-dim: #9ba4b4; --pg-accent: #ffb547; --pg-accent-soft: rgba(255, 181, 71, 0.16);
  --pg-good: #6fd18b; --pg-radius: 14px; --pg-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  --pg-font: 500 16px/1.35 Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.pg-ui { font: var(--pg-font); color: var(--pg-text); }
.pg-ui .ui-label[data-ui=label] { z-index: 1; }

/* ---- screens: a frame over the world, its menu or panel inside ---- */
.pg-screen { position: absolute; inset: 0; z-index: 100; pointer-events: auto; display: flex; flex-direction: column;
  justify-content: safe center; padding: 6vh 7vw; box-sizing: border-box; overflow: hidden auto;
  overscroll-behavior: contain; touch-action: pan-y;
  background: rgba(7, 9, 13, 0.5); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  animation: pg-in 180ms ease-out both; }
.pg-screen[data-kind=title] { justify-content: safe flex-end; padding-bottom: 9vh; -webkit-backdrop-filter: none; backdrop-filter: none;
  background: linear-gradient(90deg, rgba(6, 8, 12, 0.9) 0%, rgba(6, 8, 12, 0.62) 38%, rgba(6, 8, 12, 0) 72%),
    linear-gradient(0deg, rgba(6, 8, 12, 0.55) 0%, rgba(6, 8, 12, 0) 40%); }
.pg-screen[data-kind=panel] { align-items: center; padding: 3vh 3vw; }
.pg-screen[data-kind=side] { align-items: flex-end; background: transparent; -webkit-backdrop-filter: none;
  backdrop-filter: none; pointer-events: none; padding: 2vh 1.5vw; }
.pg-screen[data-kind=side] > * { pointer-events: auto; }
@keyframes pg-in { from { opacity: 0; } to { opacity: 1; } }
.pg-brand { margin-bottom: 3.5vh; }
.pg-brand-kicker { font-size: 13px; font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase;
  color: var(--pg-accent); }
.pg-brand-title { font-size: clamp(40px, 7vw, 84px); font-weight: 900; letter-spacing: 0.02em; line-height: 0.95;
  text-transform: uppercase; margin: 0.12em 0 0.18em; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.5); }
.pg-brand-sub { font-size: 17px; color: var(--pg-dim); max-width: 30em; }
.pg-heading { font-size: 28px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 0.6em; }
.pg-footer { position: absolute; left: 7vw; right: 7vw; bottom: 3vh; display: flex; gap: 1.6em; font-size: 13px;
  color: var(--pg-dim); }
.pg-screen[data-kind=title] .pg-footer, .pg-screen[data-kind=menu] .pg-footer { justify-content: flex-start; }
.pg-detail { max-width: 34em; min-height: 3.2em; margin-top: 1.2em; color: var(--pg-dim); font-size: 15px; }
.pg-detail b { color: var(--pg-text); }
.pg-screen:is([data-kind=panel], [data-kind=side]) > .pg-detail { display: none; }

/* ---- menus (the engine's createMenu, restyled): a column of large rows ---- */
.pg-ui .pg-screen .ui-menu { position: static; transform: none; background: none; border: none; box-shadow: none;
  padding: 0; min-width: 15em; max-width: 26em; color: var(--pg-text); }
/* as wide as its longest row, its highlight over the scrim, not out over the world (WP 13.36) */
.pg-ui .pg-screen:is([data-kind=title], [data-kind=menu]) .ui-menu { width: fit-content; }
.pg-ui .pg-screen .ui-menu-title { display: none; }
.pg-ui .pg-screen .ui-menu-item { position: relative; padding: 0.42em 0.9em 0.42em 1.1em; margin: 0.12em 0;
  border-radius: 10px; font-size: 21px; font-weight: 650; letter-spacing: 0.01em; color: rgba(238, 241, 246, 0.82);
  transition: background 120ms, color 120ms; }
.pg-ui .pg-screen .ui-menu-item[data-value=selected] { color: #fff; background: var(--pg-accent-soft); }
.pg-ui .pg-screen .ui-menu-item[data-value=selected]::before { content: ''; position: absolute; left: 0; top: 18%;
  bottom: 18%; width: 4px; margin: 0; border-radius: 4px; background: var(--pg-accent); }
.pg-ui .pg-screen .ui-menu-item[data-value=disabled] { font-size: 12px; font-weight: 800; letter-spacing: 0.24em;
  text-transform: uppercase; color: var(--pg-accent); padding-top: 1em; cursor: default; }
.pg-ui .pg-screen[data-kind=list] .ui-menu { columns: 3 11em; column-gap: 1.6em; max-width: 46em; }
.pg-ui .pg-screen[data-kind=list] .ui-menu-item { font-size: 17px; padding-top: 0.32em; padding-bottom: 0.32em;
  break-inside: avoid; }
.pg-ui .pg-screen[data-kind=list] .ui-menu-item[data-value=disabled],
.pg-ui .pg-screen[data-kind=list] .ui-menu-item[data-id=back] { column-span: all; }
.pg-ui .pg-screen[data-kind=list] .ui-menu-item[data-value=disabled] { padding-top: 1.1em; font-size: 12px; }
.pg-ui .pg-screen[data-kind=list] .ui-menu-item[data-value=disabled]:first-child { padding-top: 0.2em; }

/* ---- panels (settings, Tune, the owner's checks, photo mode, the controls) ---- */
.pg-ui .ui-box { background: var(--pg-glass); border: 1px solid var(--pg-line); border-radius: var(--pg-radius);
  box-shadow: var(--pg-shadow); color: var(--pg-text); padding: 22px 26px; }
.pg-ui .pg-screen .ui-panel.ui-box { position: relative; left: auto; top: auto; right: auto; bottom: auto;
  transform: none; max-height: 88vh; overflow-y: auto; box-sizing: border-box; scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.35) transparent; scrollbar-gutter: stable; }
.pg-ui .pg-screen .pg-settings, .pg-ui .pg-screen .pg-checks { width: min(680px, 94vw); }
.pg-ui .pg-screen .pg-tune { width: min(420px, 46vw); }
.pg-ui .pg-screen .ui-panel.pg-tune { max-height: 96vh; }
.pg-ui .ui-box h2 { margin: 0 0 0.7em; font-size: 24px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.pg-ui .ui-box h3 { margin: 1.3em 0 0.5em; font-size: 12px; font-weight: 800; letter-spacing: 0.24em;
  text-transform: uppercase; color: var(--pg-accent); }
.pg-ui .ui-box p { color: var(--pg-dim); line-height: 1.45; }
.pg-ui .ui-box .pg-row { padding: 0.35em 0.5em; margin: 0.1em -0.5em; border-radius: 8px; }
.pg-ui .ui-box .pg-row:hover { background: rgba(255, 255, 255, 0.04); }
.pg-ui .ui-box select, .pg-ui .ui-box button, .pg-ui .ui-box textarea, .pg-ui .ui-box input[type=text] {
  font: 500 15px/1.3 Inter, system-ui, sans-serif; color: var(--pg-text); background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--pg-line); border-radius: 8px; padding: 0.45em 0.7em; }
.pg-ui .ui-box :is(select, button, textarea, input, summary):focus { outline: 2px solid var(--pg-accent);
  outline-offset: 1px; }
.pg-ui .ui-box select option { background: #1a1e28; color: var(--pg-text); }
.pg-ui .ui-box button { cursor: pointer; font-weight: 650; }
.pg-ui .ui-box button:hover { background: rgba(255, 255, 255, 0.13); }
.pg-ui .ui-box button[data-value=selected] { border-color: var(--pg-accent); background: var(--pg-accent-soft); outline: none; }
.pg-ui .ui-box input[type=range] { accent-color: var(--pg-accent); width: 100%; }
.pg-ui .ui-box input[type=checkbox] { accent-color: var(--pg-accent); width: 18px; height: 18px; }
.pg-ui .pg-settings .pg-row { display: grid; grid-template-columns: 1fr 1.2fr; gap: 0.6em; align-items: center; }
.pg-ui .pg-settings [data-ui=binding-note] { grid-column: 1 / -1; font-size: 0.85em; opacity: 0.8; }
.pg-ui .pg-checks button { display: block; width: 100%; text-align: left; margin: 0.25em 0; padding: 0.6em 0.8em; }
.pg-ui .pg-checks p { margin: 0.4em 0; }
.pg-ui .pg-checks .pg-small { font-size: 0.85em; opacity: 0.8; }
.pg-ui .pg-tune { font-size: 0.85em; }
.pg-ui .pg-tune .pg-row { display: grid; grid-template-columns: 1fr 1.4fr 3em; gap: 0.4em; align-items: center; }
.pg-ui .pg-tune details { border-top: 1px solid var(--pg-line); margin: 0.2em 0; padding: 0.3em 0; }
.pg-ui .pg-tune summary { cursor: pointer; font-weight: 650; padding: 0.2em 0; }
.pg-ui .pg-tune textarea, .pg-ui .pg-checks textarea { width: 100%; box-sizing: border-box; }
.pg-ui .pg-checks textarea { min-height: 4.5em; }
.pg-ui .pg-tune textarea { height: 9em; font: 13px/1.35 ui-monospace, Menlo, Consolas, monospace; }
.pg-ui .pg-back { margin-top: 1.4em; }
.pg-ui [data-ui=attract] { left: 50%; top: auto; bottom: 12%; transform: translateX(-50%); padding: 6px 14px; }
.pg-ui [data-ui=photo] { position: absolute; left: 50%; top: auto; bottom: 3vh; transform: translateX(-50%);
  padding: 10px 18px; border-radius: 999px; font-size: 14px; color: var(--pg-dim); width: max-content;
  max-width: calc(100% - 2em); box-sizing: border-box; text-align: center; pointer-events: none; }

/* ---- the controls sheet ---- */
.pg-ui .pg-screen .pg-help { width: min(880px, 94vw); }
.pg-groups { columns: 2 20em; column-gap: 2.6em; }
.pg-group { break-inside: avoid; }
.pg-group h3:first-child { margin-top: 0.4em; }
.pg-keys { display: grid; gap: 0.1em; }
.pg-key { display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.3em 0;
  border-bottom: 1px solid var(--pg-line); font-size: 15px; }
.pg-kbd, .pg-ui kbd { display: inline-block; min-width: 1.4em; padding: 0.12em 0.5em; border-radius: 6px; text-align: center;
  font: 700 13px/1.4 Inter, system-ui, sans-serif; color: var(--pg-text); background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18); border-bottom-width: 2px; white-space: nowrap; }

/* ---- the HUD (labs/playground/ui/hud.ts): every line a chip of one dark glass with light text, small, at the edges,
   readable on sky, stone and grass alike (WP 13.36: grey text with no backing read 1.0 to 1.9 to 1 on them); hidden
   under a screen but Tune ---- */
.pg-ui:has(> .pg-screen:not([data-kind=side])) :is(.ui-hud, .ui-crosshair, .ui-damage, .pg-card, .ui-label) {
  visibility: hidden; }
body:has(.pg-ui > .pg-screen, .pg-ui > [data-ui=photo]:not([hidden])) > .feel-panel { display: none; }
/* the touch buttons (engine/ui/touch.css, above the overlay) would take a screen's taps: only the menu button stays */
body:has(.pg-ui > .pg-screen, .pg-ui > [data-ui=photo]:not([hidden])) .touch-layer .touch-button { visibility: hidden; }
.pg-ui .ui-hud { font-size: 13px; font-weight: 700; color: var(--pg-text); text-shadow: none;
  background: rgba(10, 12, 18, 0.72); border: 1px solid var(--pg-line); padding: 0.35em 0.75em; border-radius: 8px; }
.pg-ui .ui-hud[data-id=room] { font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }
.pg-ui .ui-hud[data-id=mode] { font-size: 12px; letter-spacing: 0.08em; transition: opacity 600ms ease; }
.pg-ui .ui-hud[data-id=mode][data-value=faded] { opacity: 0; }
.pg-ui .ui-hud[data-id=readout] { font-variant-numeric: tabular-nums; min-width: 9.5em; text-align: center; }
.pg-ui .ui-hud[data-id=use] { font-size: 16px; padding: 0.45em 1em; border-radius: 999px; margin-bottom: 9vh; }
.pg-ui .ui-hud[data-id=weapon] { font-size: 15px; padding: 0.45em 0.9em; border-radius: 10px; }
.pg-ui .ui-hud[data-id=check] { border-color: var(--pg-accent); }

/* ---- the feel panel (engine/dev/feel/panel.ts, a child of the body; labs/playground/feel.ts heads it): a glass panel at
   the right, as Tune's ---- */
body > .feel-panel { top: 2vh; bottom: 2vh; right: 1.5vw; width: min(420px, 46vw); padding: 22px 26px;
  font: var(--pg-font); font-size: 14px; color: var(--pg-text); background: var(--pg-glass);
  border: 1px solid var(--pg-line); border-radius: var(--pg-radius); box-shadow: var(--pg-shadow);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.35) transparent; }
body > .feel-panel h2 { margin: 0 0 0.5em; font-size: 24px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
body > .feel-panel p { margin: 0 0 1em; color: var(--pg-dim); line-height: 1.45; }
body > .feel-panel header { gap: 0.4em; margin-bottom: 0.8em; }
body > .feel-panel :is(button, textarea) { font: 650 14px/1.3 Inter, system-ui, sans-serif; color: var(--pg-text);
  background: rgba(255, 255, 255, 0.07); border: 1px solid var(--pg-line); border-radius: 8px; padding: 0.45em 0.7em; }
body > .feel-panel button { cursor: pointer; }
body > .feel-panel button:hover { background: rgba(255, 255, 255, 0.13); }
body > .feel-panel :is(button, textarea, input):focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 1px; }
body > .feel-panel textarea { box-sizing: border-box; height: 9em; font: 13px/1.35 ui-monospace, Menlo, Consolas, monospace; }
body > .feel-panel input[type=range] { accent-color: var(--pg-accent); width: 100%; }
body > .feel-panel details { border-top: 1px solid var(--pg-line); padding: 0.3em 0; }
body > .feel-panel summary { margin: 0; padding: 0.2em 0; font-weight: 650; }
body > .feel-panel label { grid-template-columns: 7.5em 1fr 4.5em; gap: 0.4em; padding: 0.15em 0; color: var(--pg-dim); }
body > .feel-panel output { color: var(--pg-text); }

/* ---- the area card (labs/playground/ui/areas.ts) ---- */
.pg-card { position: absolute; left: 1.6vw; top: 9vh; z-index: 20; width: min(25em, 80vw); padding: 16px 20px;
  border-radius: var(--pg-radius); background: var(--pg-glass); border: 1px solid var(--pg-line);
  box-shadow: var(--pg-shadow); pointer-events: none; opacity: 0; transform: translateX(-12px);
  transition: opacity 260ms ease, transform 260ms ease; }
.pg-card[data-value=shown] { opacity: 1; transform: none; }
.pg-card-kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.28em; text-transform: uppercase; color: var(--pg-accent); }
.pg-card-title { font-size: 24px; font-weight: 850; margin: 0.15em 0 0.3em; }
.pg-card-text { color: var(--pg-dim); font-size: 14px; line-height: 1.45; }
.pg-card ul { margin: 0.6em 0 0; padding-left: 1.1em; font-size: 14px; line-height: 1.5; }

/* ---- the world's signs (the gym's): quiet tags, never over a screen ---- */
.pg-ui .ui-label { background: rgba(10, 12, 18, 0.62); border-radius: 6px; font-size: 12px; font-weight: 700;
  letter-spacing: 0.04em; padding: 0.18em 0.55em; }

/* ---- the splash (labs/playground/ui/splash.ts) ---- */
.pg-splash { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.6em; font: var(--pg-font); color: var(--pg-text);
  background: radial-gradient(ellipse at 50% 38%, #253049 0%, #10131b 62%, #07080c 100%);
  transition: opacity 420ms ease; }
.pg-splash[data-value=gone] { opacity: 0; pointer-events: none; }
.pg-splash .pg-brand { margin: 0; text-align: center; }
.pg-splash .pg-brand-sub { margin: 0 auto; }
.pg-splash-bar { width: min(320px, 70vw); height: 4px; margin-top: 2.2em; border-radius: 4px; overflow: hidden;
  background: rgba(255, 255, 255, 0.1); }
.pg-splash-bar::after { content: ''; display: block; width: 36%; height: 100%; border-radius: 4px;
  background: var(--pg-accent); animation: pg-bar 1.15s ease-in-out infinite; }
.pg-splash[data-value=ready] .pg-splash-bar { visibility: hidden; }
@keyframes pg-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(280%); } }
.pg-splash-status { min-height: 1.5em; margin-top: 0.8em; font-size: 15px; color: var(--pg-dim); }
.pg-splash[data-value=ready] .pg-splash-status { color: var(--pg-text); animation: pg-pulse 1.6s ease-in-out infinite; }
@keyframes pg-pulse { 50% { opacity: 0.45; } }
.pg-splash-foot { position: absolute; bottom: 3.5vh; font-size: 12px; letter-spacing: 0.08em; color: rgba(155, 164, 180, 0.7); }
@media (prefers-reduced-motion: reduce) { .pg-screen, .pg-splash-bar::after, .pg-splash-status { animation: none !important; } }
@media (max-width: 720px) { .pg-screen { padding: 4vh 5vw; } .pg-ui .pg-screen .ui-menu-item { font-size: 18px; } }
@media (max-height: 720px) {
  .pg-screen { padding-top: 3vh; padding-bottom: 3vh; }
  .pg-screen[data-kind=title] { padding-bottom: 5vh; }
  .pg-screen .pg-brand { margin-bottom: 1.5vh; } .pg-screen .pg-brand-sub { display: none; }
  .pg-screen .pg-brand-title { font-size: clamp(30px, min(7vw, 10vh), 84px); }
  .pg-ui .pg-screen .ui-menu-item { font-size: 18px; padding-top: 0.3em; padding-bottom: 0.3em; margin: 0.06em 0; }
  .pg-detail { min-height: 2.6em; margin-top: 0.6em; }
  .pg-footer { position: static; margin-top: 1.5vh; }
}
@media (max-height: 460px) {
  .pg-ui .pg-screen .ui-menu-item, .pg-ui .pg-screen[data-kind=list] .ui-menu-item { font-size: 15px;
    padding-top: 0.2em; padding-bottom: 0.2em; }
  .pg-screen .pg-brand-kicker, .pg-detail { display: none; }
}
`;

/** Adds the theme's stylesheet to `doc` once (see the file comment). */
export function installTheme(doc: Document): void {
  const had = doc.getElementById(THEME_ID);
  if (had)
    doc.head.append(had); // after the engine's sheets added since (the overlay's, which ties with `.pg-ui`)
  else doc.head.append(Object.assign(doc.createElement('style'), { id: THEME_ID, textContent: THEME_CSS }));
}
