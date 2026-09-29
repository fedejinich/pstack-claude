import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { root, skills, skillPath, agentPrompt } from './runtime.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--container' || !['docker', 'podman'].includes(args[1]))) throw Error('Usage: node pi/check.mjs [--container docker|podman]');
const engine = args[1];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const pin = JSON.parse(readFileSync(join(root, 'pi/upstream.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(pin.commit)) throw Error('Pin must be a full Git SHA');
git('merge-base', '--is-ancestor', pin.commit, 'HEAD');
if (git('ls-tree', '--name-only', pin.commit, '--', 'pi').length) throw Error('Upstream now owns pi/; stop and choose a new boundary');
const diff = git('diff', '--name-only', pin.commit, '--', '.', ':(exclude)pi');
if (diff) throw Error(`Upstream files changed:\n${diff}`);
const unexpected = git('ls-files', '--others', '--exclude-standard').split('\n').filter(p => p && !p.startsWith('pi/'));
if (unexpected.length) throw Error(`Non-Pi additions: ${unexpected.join(', ')}`);
if (readFileSync(join(root, 'VERSION'), 'utf8').trim() !== pin.version) throw Error('Upstream version does not match pin');
const hook = JSON.parse(readFileSync(join(root, 'plugins/pstack/hooks/hooks.json'), 'utf8'));
if (!hook.hooks.SessionStart.some(h => h.matcher === 'startup|resume|clear|compact')) throw Error('Upstream hook lifecycle changed; review Pi mapping');
const names = readdirSync(skills).filter(name => !name.startsWith('.'));
for (const name of names) skillPath(name);
for (const name of ['poteto-agent', 'comment-sicko']) agentPrompt(name);
git('diff', '--check');
console.log(`Candidate ${git('rev-parse', 'HEAD')}; tracked dirty: ${git('status', '--porcelain', '--untracked-files=no') ? 'yes' : 'no'}`);
console.log(`Checking upstream ${pin.version} ${pin.commit}; ${names.length} original skills; additions confined to pi/`);
execFileSync('node', ['--test', ...readdirSync(join(root, 'pi/verification')).filter(n => n.endsWith('.test.mjs')).map(n => join(root, 'pi/verification', n))], { cwd: root, stdio: 'inherit' });
if (!engine) {
  execFileSync('node', ['pi/verification/upstream-check.mjs'], { cwd: root, stdio: 'inherit' });
} else {
  const context = mkdtempSync(join(tmpdir(), 'pstack-image-'));
  try {
    // Empty build context: no credentials, local evidence, or repo files enter image layers.
    const image = execFileSync(engine, ['build', '--quiet', '--file', join(root, 'pi/verification/Containerfile'), context],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').at(-1);
    if (!/^(sha256:)?[a-f0-9]{64}$/.test(image)) throw Error(`Unexpected container image ID: ${image}`);
    // Test actual working-tree bytes, not a separately fetched upstream tree.
    // Gitignored evidence, credentials and dependency directories are excluded.
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
    const archive = execFileSync('tar', ['-cf', '-', '--null', '-T', '-'], { cwd: root, input: files, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } });
    console.log(`Candidate archive SHA256 ${createHash('sha256').update(archive).digest('hex')}; image ${image}`);
    execFileSync(engine, ['run', '--rm', '-i', image], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
  } finally { rmSync(context, { recursive: true, force: true }); }
}
console.log(`PASS integrity, Pi adapter and upstream checks (${pin.version} ${pin.commit})`);
