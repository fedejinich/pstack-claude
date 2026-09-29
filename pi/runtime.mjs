import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, realpathSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const plugin = join(root, 'plugins/pstack');
export const skills = join(plugin, 'skills');
export const efforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const aliases = JSON.parse(readFileSync(join(plugin, 'models.json'), 'utf8')).available;

export function loadConfig(path) {
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { routing: true, models: {}, roles: {} }; throw error; }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw Error('PStack config must be an object');
  for (const key of Object.keys(config)) if (!['routing', 'models', 'roles'].includes(key)) throw Error(`Unknown PStack setting: ${key}`);
  if (config.routing !== undefined && typeof config.routing !== 'boolean') throw Error('routing must be boolean');
  for (const key of ['models', 'roles']) {
    if (config[key] !== undefined && (!config[key] || Array.isArray(config[key]) || typeof config[key] !== 'object')) throw Error(`${key} must be an object`);
    for (const value of Object.values(config[key] ?? {})) {
      if (typeof value !== 'string' || !value.trim()) throw Error(`${key} values must be nonempty model strings`);
    }
  }
  return { routing: true, models: {}, roles: {}, ...config };
}

export function resolveModel(requested, role, config, parent, available) {
  let name = requested ?? config.roles[role] ?? 'inherit-parent';
  name = config.models[name] ?? name;
  if (['auto', 'inherit-parent'].includes(name)) name = parent;
  if (!name) throw Error('No parent model; choose an explicit model');
  if (name.startsWith('claude:')) {
    const model = name.slice(7);
    if (!aliases.includes(model) && !/^claude-[a-z0-9.-]+$/.test(model)) throw Error(`Invalid Claude model: ${model}`);
    return { runtime: 'claude', model, label: name };
  }
  if (!available.includes(name)) throw Error(`Unavailable Pi model: ${name}. Configure pstack.json models/roles or choose a model from pstack_runtime.`);
  return { runtime: 'pi', model: name, label: name };
}

export function skillPath(name) {
  const bare = name.replace(/^pstack:/, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bare)) throw Error('Invalid skill name');
  const path = realpathSync(join(skills, bare, 'SKILL.md'));
  if (!path.startsWith(realpathSync(skills) + '/')) throw Error('Skill escapes installed tree');
  return path;
}

export function agentPrompt(name = 'general-purpose') {
  const bare = name.replace(/^pstack:/, '');
  if (bare === 'general-purpose') return '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bare)) throw Error('Invalid agent name');
  const folder = bare.startsWith('effort-') || /^poteto-agent-(low|medium|high|xhigh|max)$/.test(bare) ? 'effort-agents' : 'agents';
  const text = readFileSync(join(plugin, folder, `${bare}.md`), 'utf8');
  return text.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export function agentEffort(name = '') {
  return name.replace(/^pstack:/, '').match(/^(?:effort|poteto-agent)-(low|medium|high|xhigh|max)$/)?.[1];
}

export function runtimePrompt(config) {
  const compatibility = readFileSync(join(root, 'pi/compatibility.md'), 'utf8');
  const hook = config.routing ? readFileSync(join(plugin, 'hooks/session-start-context.md'), 'utf8') :
    'PStack automatic routing is OFF. Do not apply its routing mandate from earlier context. Explicit skill requests still work.';
  return `${compatibility}\n\nInstalled PStack skills: ${skills}\nPi PStack configuration: ${JSON.stringify(config)}\n\n${hook}`;
}

export function workerCommand(model, { cwd, directory, prompt, agent, thinking, depth }) {
  if (!efforts.includes(thinking)) throw Error(`Unsupported thinking level: ${thinking}`);
  const instructions = agentPrompt(agent);
  const promptFile = join(directory, 'instructions.md');
  writeFileSync(promptFile, instructions, { mode: 0o600 });
  if (model.runtime === 'claude') {
    if (['off', 'minimal'].includes(thinking)) throw Error('Claude workers require low/medium/high/xhigh/max effort');
    return {
      command: 'claude',
      args: ['--print', '--verbose', '--output-format', 'stream-json', '--model', model.model,
        '--effort', thinking, '--permission-prompts', 'none', '--plugin-dir', plugin,
        '--append-system-prompt', `${instructions}\nDelegated task only. Do not widen scope.`, '--', prompt],
      cwd,
    };
  }
  return {
    command: 'pi',
    args: ['--print', '--mode', 'json', '--model', model.model, '--thinking', thinking,
      '--session-dir', join(directory, 'sessions'),
      ...(process.env.PI_PSTACK_ISOLATED === '1' ? ['--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-approve'] : []),
      '--extension', join(root, 'pi/extension.ts'),
      '--append-system-prompt', promptFile, '--', prompt],
    cwd,
  };
}

export class Workers {
  jobs = new Map();
  constructor(directory, { depth = 0, command = workerCommand } = {}) {
    this.directory = directory;
    this.depth = depth;
    this.command = command;
  }

  start(model, options) {
    if (this.depth >= 3) throw Error('Delegation depth limit (3); return the blocked work to the coordinator');
    if ([...this.jobs.values()].filter(j => j.status === 'running').length >= 8) throw Error('Eight workers already running; wait before spawning more');
    const cwd = realpathSync(options.cwd);
    const id = randomUUID();
    const directory = join(this.directory, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const invocation = this.command(model, { ...options, cwd, directory, depth: this.depth });
    const log = join(directory, 'events.jsonl');
    const err = join(directory, 'stderr.log');
    const errFd = openSync(err, 'a', 0o600);
    writeFileSync(log, '', { mode: 0o600 });
    const child = spawn(invocation.command, invocation.args, {
      cwd, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', errFd],
      env: { ...process.env, PI_PSTACK_DEPTH: String(this.depth + 1) },
    });
    closeSync(errFd);
    const job = { id, model: model.label, runtime: model.runtime, cwd, directory, log, err,
      status: 'running', output: '', error: '', usage: [], child, done: null, started: new Date().toISOString() };
    this.jobs.set(id, job);
    let pending = '';
    let final = false;
    let answer = false;
    let identity = false;
    let lastError = '';
    const observeIdentity = actual => {
      identity = true;
      const matches = model.runtime === 'pi' ? actual === model.label :
        aliases.includes(model.model) ? actual.startsWith(`claude-${model.model}-`) : actual === model.model;
      if (!matches) job.error = `Worker changed model to ${actual}; requested ${model.label}`;
    };
    const record = line => {
      let event;
      try { event = JSON.parse(line); } catch { job.error = 'Invalid JSON worker output'; return; }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const message = event.message;
        job.output = (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
        lastError = ['error', 'aborted'].includes(message.stopReason) ? message.errorMessage || message.stopReason : '';
        answer = true;
        if (message.provider && message.model) observeIdentity(`${message.provider}/${message.model}`);
        if (message.usage) job.usage.push({ provider: message.provider, model: message.model, usage: message.usage });
      }
      if (model.runtime === 'pi' && event.type === 'agent_settled') final = true;
      if (model.runtime === 'claude' && event.type === 'assistant' && !event.parent_tool_use_id && event.message?.model) observeIdentity(event.message.model);
      if (model.runtime === 'claude' && event.type === 'result') {
        final = true;
        answer = true;
        job.output = event.result ?? '';
        lastError = event.is_error ? JSON.stringify(event.errors ?? event.result ?? event.subtype) : '';
        if (event.permission_denials?.length) lastError = `Worker permissions denied: ${JSON.stringify(event.permission_denials)}`;
        job.usage.push({ model: model.label, actualModels: Object.keys(event.modelUsage ?? {}), usage: event.usage, cost: event.total_cost_usd });
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      appendFileSync(log, chunk);
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (line) record(line);
      }
      if (pending.length > 8 * 1024 * 1024) { job.error = 'Worker JSON record exceeds 8 MiB'; void this.stop(id); }
    });
    child.on('error', error => { job.error = error.message; });
    job.done = new Promise(resolveDone => child.on('close', (code, signal) => {
      if (pending.trim()) record(pending);
      job.error ||= lastError;
      if (job.status !== 'stopping') {
        if (code !== 0 || !final) job.error ||= `Worker exited ${code ?? signal} without successful completion; see ${err}`;
        if (!answer || !job.output.trim()) job.error ||= 'Worker supplied no final answer';
        if (!identity) job.error ||= 'Worker supplied no verifiable model identity';
        if (job.error) {
          const stderr = readFileSync(err, 'utf8').slice(-4000).trim();
          if (stderr) job.error += `\nWorker stderr: ${stderr}`;
        }
      }
      job.status = job.status === 'stopping' ? 'stopped' : job.error ? 'failed' : 'completed';
      job.finished = new Date().toISOString();
      writeFileSync(join(directory, 'result.json'), JSON.stringify(this.view(id), null, 2) + '\n', { mode: 0o600 });
      resolveDone(this.view(id));
    }));
    return this.view(id);
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw Error('Unknown worker in this session');
    return job;
  }

  view(id) {
    const { child, done, ...job } = this.get(id);
    return { ...job, output: job.output.slice(-24000), truncated: job.output.length > 24000 };
  }

  async wait(id, seconds = 60, signal) {
    const job = this.get(id);
    if (signal?.aborted) { await this.stop(id); throw Error('Wait aborted; worker stopped'); }
    let timer;
    let abort;
    try {
      return await Promise.race([job.done,
        new Promise(resolveWait => { timer = setTimeout(() => resolveWait(this.view(id)), seconds * 1000); }),
        new Promise((_, reject) => { abort = () => reject(Error('Wait aborted; worker stopped')); signal?.addEventListener('abort', abort, { once: true }); }),
      ]);
    } catch (error) {
      if (signal?.aborted) await this.stop(id);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async stop(id) {
    const job = this.get(id);
    if (['completed', 'failed', 'stopped'].includes(job.status)) return this.view(id);
    job.status = 'stopping';
    const kill = signal => {
      try {
        if (process.platform === 'win32') job.child.kill(signal);
        else if (job.child.pid) process.kill(-job.child.pid, signal);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    kill('SIGTERM');
    // Leave descendants time to finish their shorter, depth-bounded cleanup.
    const timer = setTimeout(() => kill('SIGKILL'), Math.max(1, 4 - this.depth) * 3000);
    try { return await job.done; } finally { clearTimeout(timer); }
  }

  async close() { await Promise.all([...this.jobs.keys()].map(id => this.stop(id))); }
}
