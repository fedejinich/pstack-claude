import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workers, loadConfig, resolveModel, runtimePrompt, skillPath, agentPrompt, agentEffort, workerCommand, plugin } from '../runtime.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const piModel = { runtime: 'pi', model: 'test/model', label: 'test/model' };
const prompt = 'Say hello';
const successful = `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'test',model:'model',content:[{type:'text',text:'hello'}],stopReason:'stop',usage:{input:2,output:3}}}));console.log(JSON.stringify({type:'agent_settled'}));`;
function fake(script) { return () => ({ command: process.execPath, args: ['-e', script] }); }
function pool(t, dir, script = successful, options = {}) {
  const p = new Workers(dir, { command: fake(script), ...options });
  t.after(() => p.close());
  return p;
}

test('missing config defaults to routing on without creating files', t => {
  const dir = fixture(t);
  assert.deepEqual(loadConfig(join(dir, 'absent')), { routing: true, models: {}, roles: {} });
  assert.deepEqual(readdirSync(dir), []);
});

test('configuration rejects malformed and unknown settings rather than silently reverting', t => {
  const file = join(fixture(t), 'config.json');
  for (const value of ['{', 'null', '[]', '{"routing":"off"}', '{"model": "x"}', '{"models": []}', '{"roles":{"worker":null}}']) {
    writeFileSync(file, value);
    assert.throws(() => loadConfig(file));
  }
  writeFileSync(file, '{"routing":false,"models":{"opus":"test/model"}}');
  assert.equal(loadConfig(file).routing, false);
});

test('model resolution preserves explicit identities and refuses fallback', () => {
  const config = { models: { opus: 'test/model' }, roles: { worker: 'test/model' } };
  assert.equal(resolveModel('opus', undefined, config, undefined, ['test/model']).label, 'test/model');
  assert.equal(resolveModel(undefined, 'worker', config, 'other/model', ['test/model']).label, 'test/model');
  assert.equal(resolveModel('auto', undefined, config, 'other/model', ['other/model']).label, 'other/model');
  assert.equal(resolveModel('claude:opus', undefined, config, undefined, []).runtime, 'claude');
  assert.throws(() => resolveModel('fable', undefined, config, 'test/model', ['test/model']), /Unavailable/);
  assert.throws(() => resolveModel('claude:../../x', undefined, config, undefined, []));
});

test('routing uses upstream mandate verbatim and off removes it', () => {
  const original = readFileSync(join(plugin, 'hooks/session-start-context.md'), 'utf8');
  assert.ok(runtimePrompt({ routing: true }).endsWith(original));
  assert.ok(!runtimePrompt({ routing: false }).includes(original));
  assert.match(runtimePrompt({ routing: false }), /automatic routing is OFF/);
});

test('skill loader returns originals and rejects traversal', () => {
  assert.equal(skillPath('pstack:tdd'), join(plugin, 'skills/tdd/SKILL.md'));
  for (const name of ['../README', '/tmp/skill', 'pstack:../../x']) assert.throws(() => skillPath(name));
  assert.match(agentPrompt('pstack:poteto-agent'), /Read the `poteto-mode`/);
  assert.match(agentPrompt('pstack:comment-sicko'), /comment/i);
  assert.throws(() => agentPrompt('../README'));
});

test('Pi worker receives explicit model, session directory, original skills adapter and normal permissions', t => {
  const dir = fixture(t);
  const c = workerCommand(piModel, { directory: dir, cwd: dir, prompt: '-a malicious-looking task', thinking: 'low', agent: 'general-purpose' });
  assert.equal(c.command, 'pi');
  assert.ok(c.args.includes('test/model'));
  assert.ok(c.args.includes('--session-dir'));
  assert.ok(!c.args.includes('--approve'));
  assert.deepEqual(c.args.slice(-2), ['--', '-a malicious-looking task']);
});

test('Claude uses its CLI, native plugin and denied unattended prompts, never permission bypass', t => {
  const dir = fixture(t);
  const c = workerCommand({ runtime: 'claude', model: 'opus' }, { directory: dir, cwd: dir, prompt, thinking: 'high' });
  assert.equal(c.command, 'claude');
  assert.ok(c.args.includes(plugin));
  assert.ok(c.args.includes('--permission-prompts'));
  assert.ok(!c.args.includes('--dangerously-skip-permissions'));
});

test('workers run concurrently, keep independent IDs and preserve evidence/usage', async t => {
  const dir = fixture(t);
  const p = pool(t, dir, `setTimeout(()=>{${successful}},200)`);
  const a = p.start(piModel, { cwd: dir, prompt });
  const b = p.start(piModel, { cwd: dir, prompt });
  assert.notEqual(a.id, b.id);
  assert.equal(p.view(a.id).status, 'running');
  assert.equal(p.view(b.id).status, 'running');
  const results = await Promise.all([p.wait(a.id), p.wait(b.id)]);
  for (const result of results) {
    assert.equal(result.status, 'completed');
    assert.equal(result.output, 'hello');
    assert.equal(result.usage[0].usage.input, 2);
    assert.match(readFileSync(result.log, 'utf8'), /agent_settled/);
    assert.equal(JSON.parse(readFileSync(join(result.directory, 'result.json'), 'utf8')).status, 'completed');
  }
});

test('wait timeout is running, stop waits for exit and is idempotent', async t => {
  const dir = fixture(t);
  const p = pool(t, dir, 'setInterval(()=>{},1000)');
  const job = p.start(piModel, { cwd: dir, prompt });
  assert.equal((await p.wait(job.id, 0.01)).status, 'running');
  assert.equal((await p.stop(job.id)).status, 'stopped');
  assert.equal((await p.stop(job.id)).status, 'stopped');
});

test('cancelled wait stops its worker', async t => {
  const dir = fixture(t);
  const p = pool(t, dir, 'setInterval(()=>{},1000)');
  const job = p.start(piModel, { cwd: dir, prompt });
  const abort = new AbortController();
  const wait = p.wait(job.id, 5, abort.signal);
  abort.abort();
  await assert.rejects(wait, /aborted/);
  assert.equal(p.view(job.id).status, 'stopped');
});

test('process failures, invalid JSON and missing completion are failures', async t => {
  const dir = fixture(t);
  for (const script of ['process.exit(2)', 'console.log("oops")', 'console.log(JSON.stringify({type:"agent_start"}))', 'console.log(JSON.stringify({type:"agent_settled"}))', successful.replace("provider:'test',model:'model',", '')]) {
    const p = pool(t, dir, script);
    const job = p.start(piModel, { cwd: dir, prompt });
    assert.equal((await p.wait(job.id)).status, 'failed');
  }
});

test('Pi model error and Claude denied permissions cannot pass on exit zero', async t => {
  const dir = fixture(t);
  for (const [model, event, error] of [
    [piModel, { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'quota' } }, /quota/],
    [{ runtime: 'claude', model: 'sonnet', label: 'claude:sonnet' }, { type: 'result', result: 'not done', permission_denials: [{ tool_name: 'Bash' }] }, /permissions denied/],
  ]) {
    const p = pool(t, dir, `console.log(${JSON.stringify(JSON.stringify(event))});console.log(JSON.stringify({type:'agent_settled'}))`);
    const job = p.start(model, { cwd: dir, prompt });
    const result = await p.wait(job.id);
    assert.equal(result.status, 'failed');
    assert.match(result.error, error);
  }
});

test('limits reject new work rather than dropping existing workers', async t => {
  const dir = fixture(t);
  const nested = pool(t, dir, successful, { depth: 3 });
  assert.throws(() => nested.start(piModel, { cwd: dir, prompt }), /depth limit/);
  const p = pool(t, dir, 'setInterval(()=>{},1000)');
  for (let i = 0; i < 8; i++) p.start(piModel, { cwd: dir, prompt });
  assert.throws(() => p.start(piModel, { cwd: dir, prompt }), /Eight workers/);
  await p.close();
  assert.ok([...p.jobs.keys()].every(id => p.view(id).status === 'stopped'));
});

test('effort-specific upstream agent names retain their declared effort', () => {
  assert.equal(agentEffort('pstack:poteto-agent-xhigh'), 'xhigh');
  assert.equal(agentEffort('effort-max'), 'max');
  assert.equal(agentEffort('general-purpose'), undefined);
});

test('unexpected Pi model identity fails rather than accepting a silent substitution', async t => {
  const dir = fixture(t);
  const p = pool(t, dir, successful.replace("provider:'test',model:'model'", "provider:'other',model:'substitute'"));
  const job = p.start(piModel, { cwd: dir, prompt });
  const result = await p.wait(job.id);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /changed model/);
});

test('Claude requires an observed matching main-worker model, not just a requested label', async t => {
  const dir = fixture(t);
  for (const [actual, expected] of [['claude-sonnet-4-6', 'completed'], ['claude-opus-4-6', 'failed'], [null, 'failed']]) {
    const events = [
      ...(actual ? [{ type: 'assistant', message: { model: actual } }] : []),
      { type: 'result', result: 'hello', modelUsage: { [actual ?? 'unknown']: {} }, usage: { input_tokens: 1 } },
    ];
    const p = pool(t, dir, events.map(e => `console.log(${JSON.stringify(JSON.stringify(e))})`).join(';'));
    const job = p.start({ runtime: 'claude', model: 'sonnet', label: 'claude:sonnet' }, { cwd: dir, prompt });
    assert.equal((await p.wait(job.id)).status, expected);
  }
});

test('Claude synthetic quota messages preserve the API failure, not a model-substitution error', async t => {
  const dir = fixture(t);
  const events = [
    { type: 'assistant', is_api_error_message: true, message: { model: '<synthetic>' } },
    { type: 'result', is_error: true, result: "You've hit your weekly limit", modelUsage: {} },
  ];
  const p = pool(t, dir, events.map(e => `console.log(${JSON.stringify(JSON.stringify(e))})`).join(';'));
  const job = p.start({ runtime: 'claude', model: 'sonnet', label: 'claude:sonnet' }, { cwd: dir, prompt });
  const result = await p.wait(job.id);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /weekly limit/);
  assert.doesNotMatch(result.error, /changed model/);
});

test('unknown worker ID is session scoped', t => {
  const p = pool(t, fixture(t));
  assert.throws(() => p.view('some-other-session'), /Unknown worker/);
});
