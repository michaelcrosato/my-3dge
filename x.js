// x.js: `node x <cmd>` (PLAN.md §8.1). Registers tsx so Node runs the TypeScript tools, then hands over to the
// dispatcher in tools/x.ts, whose file comment documents the commands, the output contract and the exit codes.
import { register } from 'tsx/esm/api';

register();
const { dispatch } = await import('./tools/x.ts');
process.exitCode = await dispatch(process.argv.slice(2));
