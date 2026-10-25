/**
 * @file What the MCP bridge's tools run on (PLAN.md §8.11, WP 7.6): a `Backend`, the engine as one interface,
 * whichever process holds it. `pageBackend` (tools/mcp/session.ts) is a page in the `x inspect` session, on WebGPU;
 * `headlessBackend` (tools/mcp/headless.ts) is `createHeadless` in this process, with the scene's view but no
 * renderer. The tools (tools/mcp/tools.ts) are written once against this interface, so a T1 test drives them without
 * a browser and a T2 spec drives the same calls in the page (docs/TESTING.md's tiers).
 *
 * A backend opens a page with URL parameters as the page's routes read them (engine/app/routes.ts), calls inspector
 * members by name with their arguments in call order (a value member, `errors`, is read), and readies a run for a
 * replay of a scene. What happened since the last call that the caller should know first (the page reloaded after a
 * change) comes back from `notices`, once.
 *
 * Invariants: results are plain JSON; a failure throws an `Error` whose first line names what went wrong and the
 * fix (an engine error keeps its `[CODE] message: fix`).
 *
 * @example
 * openPath('labs/box', { scene: 'room', 'box.room.speed': 3 }); // 'labs/box/?scene=room&box.room.speed=3'
 * @see tools/mcp/server.test.ts
 */
import { pageUrl } from '../cmd/shot';

/** URL parameters for a page: routes (`scene`, `seed`, `cam`, `cam3`, `replay`) and settings by path. */
export type Params = Record<string, unknown>;

/** What `x mcp`'s flags (or the last `engine_open`) asked to open. */
export interface OpenArgs {
  page: string;
  params?: Params;
}

/** A page or scene opened: what it is, whether it signalled ready, its error records and `info()`. */
export interface Opened {
  page: string;
  ready: boolean;
  errors: string[];
  info?: Record<string, unknown>;
  /** What to do about a page that is not ready yet. */
  note?: string;
}

/** Receives a line while a call waits (a page warming its pipelines): MCP progress for the client. */
export type Progress = (message: string) => void;

/** The engine the tools drive (see the file comment). */
export interface Backend {
  /** `page`: a page in the x inspect session; `headless`: createHeadless in this process. */
  readonly kind: 'page' | 'headless';
  /** Whether members that need a renderer (`shot`, `render`) can run. */
  readonly renders: boolean;
  /** Opens `page` with `params` and waits until it signals ready or an error. */
  open(page: string, params: Params, progress: Progress): Promise<Opened>;
  /**
   * After the server starts this backend: takes up what runs. `open` is what `x mcp`'s flags name on the `first` start,
   * then the last `engine_open`'s: a page backend opens it only on the first start, when the session shows another
   * page or none runs; a headless one, whose run ended with its process, opens it every time.
   */
  resume(open: OpenArgs | undefined, first: boolean, progress: Progress): Promise<Opened | null>;
  /** Calls member `name` with `args` in call order (reads a value member); resolves with its value as JSON. */
  call(name: string, args: readonly unknown[], progress: Progress): Promise<unknown>;
  /** Makes the run ready to play a replay of `scene`: its module loaded headless; in a page, the page showing it. */
  forReplay(scene: string, progress: Progress): Promise<void>;
  /** What the next result says first (the page reloaded…), each line once. */
  notices(): string[];
  /** Ends it; `stop` also ends the x inspect session (the server asks it when none ran before it started). */
  close(stop: boolean): Promise<void>;
}

/** The page path `page` opens with `params` as URL parameters (objects and lists as JSON), as `x inspect` writes it. */
export function openPath(page: string, params: Params = {}): string {
  const set = Object.entries(params).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`); // prettier-ignore
  return pageUrl(page, { set });
}
