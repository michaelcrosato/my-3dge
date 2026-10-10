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
import { createServer as createNetServer } from 'node:net';
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
    server: { host: '127.0.0.1', port: options.port ?? (await freePort()), strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('startVite: the dev server reported no TCP address');
  }
  return { url: `http://127.0.0.1:${address.port}/`, port: address.port, close: () => server.close() };
}

/** Asks the system for a free TCP port on 127.0.0.1. Vite reads `port: 0` as "use 5173", so it is probed here. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('freePort: no port assigned'))));
    });
  });
}
