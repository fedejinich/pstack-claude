import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Workers, loadConfig, resolveModel, runtimePrompt, skills, skillPath, efforts, agentEffort } from './runtime.mjs';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], details: undefined });

export default function pstack(pi: ExtensionAPI) {
  const configPath = join(getAgentDir(), 'pstack.json');
  const depth = Number(process.env.PI_PSTACK_DEPTH ?? '0');
  let routing: boolean | undefined;
  let workers: Workers | undefined;
  const accounted = new Map<string, number>();
  const config = () => ({ ...loadConfig(configPath), ...(routing === undefined ? {} : { routing }) });
  const models = (ctx: ExtensionContext) => ctx.modelRegistry.getAvailable().map(m => `${m.provider}/${m.id}`);
  const manager = (ctx: ExtensionContext) => workers ??= new Workers(join(getAgentDir(), 'pstack-runs', ctx.sessionManager.getSessionId()), { depth });
  const cleanup = async () => { await workers?.close(); workers = undefined; accounted.clear(); };

  pi.on('resources_discover', async () => ({ skillPaths: [skills] }));
  pi.on('session_start', async () => { await cleanup(); routing = undefined; });
  pi.on('session_before_switch', cleanup);
  pi.on('session_before_fork', cleanup);
  pi.on('session_shutdown', async () => { await cleanup(); process.off('SIGTERM', terminateWorker); });
  const terminateWorker = () => { void cleanup().finally(() => process.exit(143)); };
  process.once('SIGTERM', terminateWorker);

  pi.on('before_agent_start', async (event, ctx) => {
    const section = `${runtimePrompt(config())}\nCurrent Pi session: ${ctx.sessionManager.getSessionId()}. Configuration: ${configPath}.`;
    event.systemPromptOptions.appendSystemPrompt = [event.systemPromptOptions.appendSystemPrompt, section].filter(Boolean).join('\n\n');
  });

  pi.registerCommand('pstack', {
    description: 'PStack routing: on, off, or status (session-local override)',
    handler: async (args, ctx) => {
      const action = args.trim() || 'status';
      if (!['on', 'off', 'status'].includes(action)) throw Error('Usage: /pstack [on|off|status]');
      if (action !== 'status') routing = action === 'on';
      const message = `PStack routing ${config().routing ? 'on' : 'off'}. Session override only; persistent config: ${configPath}`;
      if (ctx.hasUI) ctx.ui.notify(message, 'info');
      else pi.sendMessage({ customType: 'pstack-status', content: message, display: true });
    },
  });

  pi.registerTool({
    name: 'pstack_skill', label: 'PStack skill',
    description: 'Load the original PStack skill by name (accepts pstack:name). Read and follow its full instructions; references resolve from its directory.',
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, { name }) {
      const path = skillPath(name);
      return text(`Skill file: ${path}\nReference base: ${dirname(path)}\n\n${readFileSync(path, 'utf8')}`);
    },
  });

  pi.registerTool({
    name: 'pstack_runtime', label: 'PStack runtime',
    description: 'Inspect Pi model availability, PStack configuration and current project session paths, or page the full active-branch transcript. Does not search other projects or call a model.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('status'), Type.Literal('history')]),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 24000 })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const session = { id: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile(),
        directory: ctx.sessionManager.getSessionDir(), cwd: ctx.cwd };
      if (params.action === 'status') return text({ configPath, config: config(), session, availableModels: models(ctx), depth,
        workerCount: workers?.jobs.size ?? 0,
        workers: workers ? [...workers.jobs.keys()].slice(-32).map(id => {
          const { model, status, cwd, directory } = workers!.view(id);
          return { id, model, status, cwd, directory };
        }) : [],
        limits: { concurrent: 8, depth: 3 },
        claude: 'Explicit claude:model transport uses Claude CLI authentication, MCPs and permissions. Aliases are not proof of availability.',
      });
      const full = ctx.sessionManager.getBranch().map(entry => JSON.stringify(entry)).join('\n');
      const offset = params.offset ?? 0;
      const end = Math.min(full.length, offset + (params.limit ?? 12000));
      return text({ session, offset, nextOffset: end < full.length ? end : null, totalChars: full.length, text: full.slice(offset, end) });
    },
  });

  pi.registerTool({
    name: 'pstack_agent', label: 'PStack worker',
    description: 'Start an independent Pi or Claude CLI worker; returns immediately. Then status, wait (bounded), or stop by ID. Explicit models only; no silent fallback. Use different worktrees for concurrent writers. Workers have normal harness permissions, not a sandbox. State and events remain on disk.',
    parameters: Type.Object({
      action: Type.Union(['start', 'status', 'wait', 'stop'].map(value => Type.Literal(value))),
      id: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String({ minLength: 1 })),
      agent: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.Union(efforts.map(value => Type.Literal(value)))),
      cwd: Type.Optional(Type.String()),
      seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
    }),
    async execute(_toolId, params, signal, _update, ctx) {
      if (signal?.aborted) throw Error('Worker operation cancelled');
      const pool = manager(ctx);
      if (params.action === 'start') {
        if (!params.prompt || !params.cwd) throw Error('start requires prompt and explicit cwd');
        const parent = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
        const model = resolveModel(params.model, params.role, config(), parent, models(ctx));
        return text(pool.start(model, { prompt: params.prompt, agent: params.agent ?? 'general-purpose',
          thinking: params.thinking ?? agentEffort(params.agent) ?? pi.getThinkingLevel(), cwd: resolve(ctx.cwd, params.cwd) }));
      }
      if (!params.id) throw Error(`${params.action} requires worker id`);
      const result = params.action === 'wait' ? await pool.wait(params.id, params.seconds, signal)
        : params.action === 'stop' ? await pool.stop(params.id) : pool.view(params.id);
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      for (const record of result.usage.slice(accounted.get(params.id) ?? 0)) {
        const u = record.usage ?? {};
        usage.input += u.input ?? u.input_tokens ?? 0;
        usage.output += u.output ?? u.output_tokens ?? 0;
        usage.cacheRead += u.cacheRead ?? u.cache_read_input_tokens ?? 0;
        usage.cacheWrite += u.cacheWrite ?? u.cache_creation_input_tokens ?? 0;
        for (const key of Object.keys(usage.cost)) usage.cost[key] += u.cost?.[key] ?? (key === 'total' ? record.cost ?? 0 : 0);
      }
      usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
      accounted.set(params.id, result.usage.length);
      return { ...text(result), usage };
    },
  });
}
