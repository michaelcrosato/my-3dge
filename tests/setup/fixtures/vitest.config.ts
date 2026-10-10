/**
 * @file Vitest's settings for the advice trap's fixture tests (WP 0.5): the repository's own (vite.config.ts, so its
 * setup file is what is proven), on `tests/setup/fixtures/*.vitest.ts` only. Only tests/setup/harnesses.test.ts runs
 * them, from the repository root; `npm test` never does, since its files end in `.test.ts`.
 */
import { defineConfig } from 'vitest/config';
import base from '../../../vite.config';

export default defineConfig({ ...base, test: { ...base.test, include: ['tests/setup/fixtures/*.vitest.ts'] } });
