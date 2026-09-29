import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { root, Workers } from '../runtime.mjs';

if (!process.argv.includes('--live')) {
  console.error('Explicit opt-in required: node pi/verification/eval.mjs --live [--model provider/model] [--case small|routing|off|tdd|investigation|workers|claude]');
  process.exit(2);
}
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const model = option('--model', 'openai-codex/gpt-6-astra');
const selected = option('--case', 'all');
const peerModel = option('--peer-model', 'openai-codex/gpt-6-sol');
const thirdModel = option('--third-model', 'openai-codex/gpt-6-luna');
if (!['all', 'small', 'routing', 'off', 'tdd', 'investigation', 'workers', 'claude'].includes(selected)) throw Error('Unknown evaluation case');
const run = mkdtempSync(join(tmpdir(), 'pstack-eval-'));
const agentDir = join(run, 'agent');
mkdirSync(agentDir, { mode: 0o700 });
const originalAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
for (const name of ['auth.json', 'models-store.json']) {
  const source = join(originalAgentDir, name);
  if (existsSync(source)) symlinkSync(source, join(agentDir, name));
}
writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: model.split('/')[0], defaultModel: model.slice(model.indexOf('/') + 1), defaultThinkingLevel: 'low', retry: { enabled: false }, enableInstallTelemetry: false, cacheWarming: 'off' }));
writeFileSync(join(agentDir, 'pstack.json'), JSON.stringify({ models: { opus: model, fable: model, sonnet: model, haiku: model } }));
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_PSTACK_ISOLATED: '1', PI_OFFLINE: '1' };
const report = { upstream: JSON.parse(readFileSync(join(root, 'pi/upstream.json'), 'utf8')), adapter: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  adapterDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
  pi: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), model, started: new Date().toISOString(),
  directory: run, config: 'Isolated Pi-only alias overrides; no claim of model diversity in workflow cases', results: [] };
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Evidence: ${run}`);
save();

async function session(name, prompt, prepare = () => {}, check = () => true, off = false, routeProbe = false) {
  const cwd = join(run, name);
  mkdirSync(cwd);
  prepare(cwd);
  const events = [];
  let pending = '';
  let stderr = '';
  let probeMatched = false;
  const args = ['--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-approve',
    '--extension', join(root, 'pi/extension.ts'), '--model', model, '--thinking', 'low', '--mode', 'json', '--session-dir', join(cwd, 'sessions'), '--print'];
  if (off) args.push('/pstack off');
  args.push(prompt);
  const child = spawn('pi', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let killTimer;
  const kill = signal => {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const terminate = () => {
    kill('SIGTERM');
    killTimer ??= setTimeout(() => kill('SIGKILL'), 15000);
  };
  const timer = setTimeout(terminate, 12 * 60 * 1000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (line.trim()) {
        let event;
        try { event = JSON.parse(line); } catch { stderr += `Invalid event: ${line}\n`; continue; }
        events.push(event);
        const start = events.find(e => e.type === 'tool_execution_start' && e.toolCallId === event.toolCallId);
        if (routeProbe && !probeMatched && event.type === 'tool_execution_end' && !event.isError &&
            start && usesSkill([start], 'poteto-mode')) {
          probeMatched = true;
          terminate();
        }
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => { child.on('error', e => { stderr += e.message; }); child.on('close', resolve); });
  clearTimeout(timer);
  clearTimeout(killTimer);
  writeFileSync(join(cwd, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(join(cwd, 'stderr.log'), stderr);
  const calls = events.filter(e => e.type === 'tool_execution_start');
  const answers = events.filter(e => e.type === 'message_end' && e.message?.role === 'assistant');
  const final = answers.at(-1)?.message;
  const output = final?.content?.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? '';
  const result = { name, status: 'failed', code, output, intentionallyStoppedAfterRouting: probeMatched, toolCalls: calls.map(c => ({ tool: c.toolName, args: c.args })),
    usage: answers.map(e => ({ model: `${e.message.provider}/${e.message.model}`, usage: e.message.usage })), evidence: cwd };
  try {
    if (!probeMatched && (code !== 0 || !events.some(e => e.type === 'agent_settled') || ['error', 'aborted'].includes(final?.stopReason))) throw Error(`Session failed: ${final?.errorMessage ?? stderr}`);
    if (!check({ cwd, events, calls, output })) throw Error('Behavioral assertions failed; inspect events and final answer');
    result.status = 'passed';
  } catch (error) { result.error = error.message; }
  report.results.push(result);
  save();
  console.log(`${result.status.toUpperCase()} ${name}`);
}
const usesSkill = (calls, name) => calls.some(c => c.toolName === 'pstack_skill' && c.args.name.replace(/^pstack:/, '') === name || c.toolName === 'read' && (c.args.path ?? c.args.file_path ?? '').endsWith(`/${name}/SKILL.md`));
const cases = {
  small: () => session('small', 'What is 2 + 2? Answer with the number only.', undefined, ({ calls, output }) => output.trim() === '4' && calls.length === 0),
  routing: () => session('routing', 'There is an intermittent bug of unknown cause spanning parser.mjs and cache.mjs. Diagnose it and plan a robust fix. Work only in this disposable fixture; do not commit, open PRs, or access external services.',
    cwd => {
      writeFileSync(join(cwd, 'parser.mjs'), 'export function parse(s) { return { words: s.split(/\\s+/) }; }\n');
      writeFileSync(join(cwd, 'cache.mjs'), "import {parse} from './parser.mjs';\nconst cache = new Map();\nexport function cached(s) { if (!cache.has(s)) cache.set(s, parse(s)); return cache.get(s); }\n");
    }, ({ calls }) => usesSkill(calls, 'poteto-mode'), false, true),
  off: () => session('off', 'Explain briefly a tradeoff between a monolith and microservices.', undefined,
    ({ calls, output }) => calls.length === 0 && output.length > 20, true),
  tdd: () => session('tdd', 'Use the tdd skill to fix add.mjs: add(2, 3) currently gives -1. Write and run a focused Node regression test before changing production code, then fix it and rerun it. Do not commit or open a PR. Work only in this disposable directory.',
    cwd => writeFileSync(join(cwd, 'add.mjs'), 'export function add(a, b) { return a - b; }\n'),
    ({ cwd, calls, events }) => {
      if (!usesSkill(calls, 'tdd')) return false;
      const results = events.filter(e => e.type === 'tool_execution_end' && e.toolName === 'bash');
      const texts = results.map(e => JSON.stringify(e.result));
      const red = texts.findIndex(s => /AssertionError|ERR_ASSERTION|not ok|fail 1/.test(s));
      const green = texts.findIndex((s, i) => i > red && /pass 1|tests 1|ok 1/.test(s));
      execFileSync('node', ['--input-type=module', '-e', "import {add} from './add.mjs';if(add(2,3)!==5)process.exit(1)"], { cwd });
      return red >= 0 && green > red;
    }),
  investigation: () => session('investigation', 'Use poteto-mode for a read-only investigation: explain how parser.mjs and cache.mjs cooperate, and assess whether caching mutable parser results is safe. Follow the complete Investigation playbook, including actual delegation through how and its required output sections. No source changes, commits, PRs, or external services. This is a disposable fixture; only these two files are relevant. If a capability is unavailable, say so rather than claiming completion.',
    cwd => {
      writeFileSync(join(cwd, 'parser.mjs'), 'export function parse(s) { return { words: s.split(/\\s+/) }; }\n');
      writeFileSync(join(cwd, 'cache.mjs'), "import {parse} from './parser.mjs';\nconst cache = new Map();\nexport function cached(s) { if (!cache.has(s)) cache.set(s, parse(s)); return cache.get(s); }\n");
    },
    ({ cwd, calls, output, events }) => {
      const completed = events.some(e => e.type === 'tool_execution_end' && e.toolName === 'pstack_agent' && JSON.stringify(e.result).includes('completed'));
      const noChange = readFileSync(join(cwd, 'parser.mjs'), 'utf8') === 'export function parse(s) { return { words: s.split(/\\s+/) }; }\n' &&
        readFileSync(join(cwd, 'cache.mjs'), 'utf8') === "import {parse} from './parser.mjs';\nconst cache = new Map();\nexport function cached(s) { if (!cache.has(s)) cache.set(s, parse(s)); return cache.get(s); }\n";
      return ['poteto-mode', 'how', 'unslop'].every(n => usesSkill(calls, n)) &&
        calls.some(c => c.toolName === 'pstack_agent' && c.args.action === 'start') && completed && noChange &&
        /throughput checkpoint/i.test(output + JSON.stringify(events)) && /mutab|mutat/i.test(output) && /cache.mjs/.test(output);
    }),
  workers: async () => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    const pool = new Workers(join(run, 'workers'));
    try {
      const ids = [model, peerModel, thirdModel].map(id => pool.start({ runtime: 'pi', model: id, label: id },
        { cwd: run, prompt: 'Reply with PI_WORKER_OK only. Do not call tools.', thinking: 'low' }).id);
      const results = await Promise.all(ids.map(id => pool.wait(id, 120)));
      const passed = results.every(r => r.status === 'completed' && r.output.includes('PI_WORKER_OK') && r.usage.some(u => `${u.provider}/${u.model}` === r.model)) && new Set(results.map(r => r.model)).size === 3;
      report.results.push({ name: 'workers', status: passed ? 'passed' : 'failed', results });
      console.log(`${passed ? 'PASSED' : 'FAILED'} workers`);
    } finally {
      await pool.close();
      for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
      Object.assign(process.env, old);
      save();
    }
  },
  claude: async () => {
    const pool = new Workers(join(run, 'claude'));
    try {
      const worker = pool.start({ runtime: 'claude', model: 'sonnet', label: 'claude:sonnet' },
        { cwd: run, prompt: 'Reply with CLAUDE_WORKER_OK only. Do not call tools.', thinking: 'low' });
      const result = await pool.wait(worker.id, 120);
      const passed = result.status === 'completed' && result.output.includes('CLAUDE_WORKER_OK');
      report.results.push({ name: 'claude', status: passed ? 'passed' : /limit|quota|auth/i.test(result.error) ? 'blocked' : 'failed', result });
    } finally { await pool.close(); save(); }
  },
};
for (const [name, execute] of Object.entries(cases)) if ((selected === 'all' && name !== 'claude') || selected === name) await execute();
report.finished = new Date().toISOString();
save();
console.log(`Report: ${join(run, 'report.json')}`);
if (report.results.some(r => r.status !== 'passed')) process.exitCode = 1;
