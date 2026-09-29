import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { root, skills } from '../runtime.mjs';

const sdkPath = process.env.PI_SDK_PATH ?? join(dirname(realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim())), 'index.js');
const { DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(sdkPath));

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-extension-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir,
    settingsManager: SettingsManager.inMemory({}), noExtensions: true, noSkills: true,
    noContextFiles: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [join(root, 'pi/extension.ts')],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find(e => e.path.endsWith('extension.ts'));
  assert.ok(extension);
  const sessionManager = SessionManager.inMemory(dir);
  const ctx = { cwd: dir, hasUI: true, ui: { notify: () => {} }, sessionManager,
    modelRegistry: { getAvailable: () => [{ provider: 'test', id: 'model' }] }, model: { provider: 'test', id: 'model' } };
  const emit = async (event, data = {}) => {
    const results = [];
    for (const handler of extension.handlers.get(event) ?? []) results.push(await handler({ type: event, ...data }, ctx));
    return results;
  };
  t.after(() => emit('session_shutdown'));
  return { extension, emit, ctx, loader, sessionManager };
}

test('actual Pi loader discovers extension, tools and unchanged skills without model calls', async t => {
  const { extension, emit, loader } = await fixture(t);
  assert.deepEqual([...extension.tools.keys()].sort(), ['pstack_agent', 'pstack_runtime', 'pstack_skill']);
  const [paths] = await emit('resources_discover');
  assert.deepEqual(paths.skillPaths, [skills]);
  loader.extendResources({ skillPaths: [{ path: skills, metadata: { source: 'pstack-test', scope: 'temporary', origin: 'top-level' } }] });
  const discovered = loader.getSkills();
  assert.ok(discovered.skills.some(s => s.name === 'poteto-mode'));
  assert.ok(discovered.skills.some(s => s.name === 'tdd'));
  assert.equal(discovered.skills.length, 54);
  assert.equal(discovered.diagnostics.filter(d => d.type === 'error').length, 0);
});

test('routing appends upstream policy, survives new prompts, and off preserves explicit tools', async t => {
  const { extension, emit, ctx } = await fixture(t);
  const options = { appendSystemPrompt: 'other-extension-policy' };
  await emit('before_agent_start', { systemPromptOptions: options });
  assert.ok(options.appendSystemPrompt.startsWith('other-extension-policy'));
  assert.match(options.appendSystemPrompt, /Invoke the `pstack:poteto-mode`/);
  await extension.commands.get('pstack').handler('off', ctx);
  const off = { appendSystemPrompt: '' };
  await emit('before_agent_start', { systemPromptOptions: off });
  assert.match(off.appendSystemPrompt, /automatic routing is OFF/);
  assert.doesNotMatch(off.appendSystemPrompt, /Invoke the `pstack:poteto-mode`/);
  const result = await extension.tools.get('pstack_skill').definition.execute('test', { name: 'tdd' });
  assert.match(result.content[0].text, /Write the failing test first/);
  await emit('session_start');
  const resumed = { appendSystemPrompt: '' };
  await emit('before_agent_start', { systemPromptOptions: resumed });
  assert.match(resumed.appendSystemPrompt, /Invoke the `pstack:poteto-mode`/);
});

test('history exports only active branch, with bounded pagination and correct workspace', async t => {
  const { extension, sessionManager, ctx } = await fixture(t);
  const first = sessionManager.appendMessage({ role: 'user', content: 'ROOT', timestamp: Date.now() });
  sessionManager.appendMessage({ role: 'user', content: 'ABANDONED-SECRET', timestamp: Date.now() });
  sessionManager.branch(first);
  sessionManager.appendMessage({ role: 'user', content: 'ACTIVE', timestamp: Date.now() });
  const tool = extension.tools.get('pstack_runtime').definition;
  let reconstructed = '';
  let offset = 0;
  do {
    const result = JSON.parse((await tool.execute('history', { action: 'history', offset, limit: 40 }, undefined, undefined, ctx)).content[0].text);
    assert.equal(result.session.cwd, ctx.cwd);
    assert.ok(result.text.length <= 40);
    reconstructed += result.text;
    offset = result.nextOffset;
  } while (offset !== null);
  assert.match(reconstructed, /ROOT/);
  assert.match(reconstructed, /ACTIVE/);
  assert.doesNotMatch(reconstructed, /ABANDONED-SECRET/);
});

test('skill tool reads upstream content, not a rewritten copy', async t => {
  const { extension } = await fixture(t);
  const result = await extension.tools.get('pstack_skill').definition.execute('skill', { name: 'pstack:poteto-mode' });
  assert.ok(result.content[0].text.endsWith(readFileSync(join(skills, 'poteto-mode/SKILL.md'), 'utf8')));
});
