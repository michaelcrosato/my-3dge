/**
 * @file A Vite dev server through Vite's JavaScript API, for the `x` commands that open pages (PLAN.md §8.1). It
 * serves the repository with `vite.config.ts`, as `npm run dev` and Playwright's `webServer` do.
 *
 * Invariants: it listens on 127.0.0.1; on a free port chosen by the system unless one is asked for, so it never
 * collides with a lane's `$PORT`; `close()` stops it.
 *
 * @example
 * const server = await startVite();
 * const page = `${server.url}tests/pages/harness.html`;
 * await server.close();
 * @see tools/lib/vite.test.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

/** A running dev server. */
export interface DevServer {
  /** The base URL, ending in `/`: `http://127.0.0.1:41234/`. */
  url: string;
  /** The port it listens on. */
  port: number;
  /** Stops the server. */
  close(): Promise<void>;
}

/** Starts Vite on the repository at `root` (default: this repository), on `port` (default: any free port). */
export async function startVite(options: { root?: string; port?: number } = {}): Promise<DevServer> {
  const root = options.root ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port: options.port ?? 0, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('startVite: the dev server reported no TCP address');
  }
  return { url: `http://127.0.0.1:${address.port}/`, port: address.port, close: () => server.close() };
}
