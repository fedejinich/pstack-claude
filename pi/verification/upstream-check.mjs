import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../runtime.mjs';

// Do not replace a failing upstream suite with a smaller passing subset.
// No native Claude/API or disposable-GitHub-repository exercises run here.
const run = (args, cwd = root) => execFileSync('bun', args, { cwd, stdio: 'inherit' });
console.log(`Upstream environment: ${process.platform}/${process.arch}, Node ${process.version}`);
run(['--version']);
run(['tools/generate.mjs', '--check']);
run(['test', 'tests/']);
const scripts = join(root, 'plugins/pstack/skills/poteto-mode/scripts');
run(['install', '--frozen-lockfile'], scripts);
run(['run', 'typecheck'], scripts);
run(['test', 'orch', 'watch-pr'], scripts);
execFileSync('bunx', ['prettier@3.6.2', '--check', '.'], { cwd: scripts, stdio: 'inherit' });
console.log('PASS all upstream deterministic suites, typecheck and formatting');
