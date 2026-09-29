# PStack on Pi

This directory adapts the original PStack skills to Pi. All files outside `pi/` remain identical to the upstream commit in `upstream.json`. No skill copies or generated rewrites are installed.

## Requirements

- Pi 0.87.1. The declared compatibility range is intentionally narrow; re-run verification before widening it.
- Node.js 22+ and Bun 1.3.14 for development checks. Docker or Podman can run the complete upstream checks in Linux without modifying upstream tests.
- Available Pi model credentials for Pi workers.
- Claude CLI authentication for explicit `claude:<model>` workers. They use Claude's own permission and MCP configuration, not Pi's.
- Workflow-specific upstream dependencies still apply: GitHub CLI, Bun, Graphite, browser or application drivers, and authoring guidance when required.

## Install

Keep the clone or submodule at a stable path. From its repository root:

```sh
pi install ./pi
```

Pi loads the extension in future sessions, discovers the original skills through its resource-discovery event, and injects the original routing mandate before each user run. It does not launch workers or call a model merely by loading. Full skills are loaded on demand. The normal entry point is `/skill:poteto-mode`; the model can also use `pstack_skill`.

Pi discovers all 54 original skills. Its skill loader does not implement Claude's `user-invocable: false` menu flag, so internal principle helpers can appear in Pi's command discovery. Their content is unchanged and still loads on demand; this adapter does not rewrite frontmatter to imitate Claude's menu.

Routing is **on by default**, with the same criteria as upstream. Small tasks proceed directly. `/pstack off` disables automatic routing for the current session without removing skills. `/pstack on` re-enables it. `/pstack status` reports the current state. A new/resumed session uses persistent configuration again.

For an isolated trial, do not install globally:

```sh
pi --no-extensions --no-skills --no-prompt-templates \
  --extension ./pi/extension.ts
```

Normal user/project context still applies to that command. The evaluation runner below goes further and isolates context and configuration.

## Configure models

Persistent configuration is `<Pi agent directory>/pstack.json`, normally `~/.pi/agent/pstack.json`. Nothing is written to Claude or Codex settings. A missing configuration enables routing but does not invent model mappings. Unavailable or unconfigured aliases fail explicitly.

For the original Claude model families through the Claude CLI:

```json
{
  "routing": true,
  "models": {
    "opus": "claude:opus",
    "fable": "claude:fable",
    "sonnet": "claude:sonnet",
    "haiku": "claude:haiku"
  },
  "roles": {}
}
```

Alternatively, map an alias to an exact available Pi `provider/model-id`. `pstack_runtime` reports credential-backed Pi availability and the current mappings. Catalog visibility alone does not prove a model can complete a call. Check each model you intend to use. A role maps to a model string; for a panel, select each configured alias explicitly in its independent worker call. Effort is passed separately as `thinking`; unsupported values are rejected by the adapter or underlying CLI, never intentionally downgraded by the adapter.

`setup-pstack` uses the runtime mapping in `compatibility.md`. It must obtain approval before writing configuration. The installed upstream skill is not modified.

## Runtime boundary

The adapter supplies three tools:

- `pstack_skill`: original skill text and its reference directory.
- `pstack_runtime`: configuration, model availability, session paths, worker status, and bounded active-branch transcript pages.
- `pstack_agent`: asynchronous `start`, `status`, bounded `wait`, and confirmed `stop`.

Pi workers inherit normal Pi discovery, credentials, project rules and permission behavior, with this extension explicitly loaded. Claude workers load the original plugin through `--plugin-dir`; unattended permission requests are denied, not bypassed. Denied permissions, missing completion events, model errors, invalid output, and nonzero exits cannot count as a successful worker.

Workers have isolated conversation contexts but **not a filesystem sandbox**. Give concurrent writers separate worktrees. The parent must review their output and diffs. Each worker records events, stderr, model usage and its result under `<agent-dir>/pstack-runs/<session-id>/<worker-id>/`. These private artifacts are not committed. Tool responses are bounded; full events stay in that directory. Usage is reported incrementally without recounting earlier status polls.

Workers belong to the session, not a durable scheduler. Limits are eight concurrent direct children and three delegation levels. Session switch, fork, shutdown, and cancelled waits stop owned workers. The adapter handles SIGTERM at every depth to clean up owned workers, with bounded escalation allowing descendants to stop first. An OS crash or SIGKILL cannot guarantee graceful cleanup; inspect process state and evidence before resuming. Do not promise unattended multi-day orchestration without checkpoint/resume handling.

`pstack_runtime history` walks Pi's active branch, including pre-compaction evidence, and excludes abandoned branches. It does not search other projects. For older sessions the compatibility instructions require checking the workspace header before reading messages.

## Verification

From the repository root:

```sh
node pi/check.mjs
```

This checks the upstream boundary and version, skill/agent references, adapter tests, the unchanged upstream generator, root tests, and **all `orch`/`watch-pr` tests, typecheck and formatting**. A failure in any required suite blocks promotion. Adapter tests live in `pi/verification/` so upstream's `bun test tests/` filter does not accidentally execute Node-only SDK tests under Bun.

The upstream 250 ms transport fixture can expire before its child starts on macOS. Do not skip it or weaken its assertion. Use the complete Linux gate on the same candidate instead:

```sh
node pi/check.mjs --container podman
# or: node pi/check.mjs --container docker
```

Start your chosen container engine first; this command does not manage its VM. Adapter/SDK tests still run against the actual local Pi installation. The upstream suite runs as a non-root Linux user using pinned Node/Bun images. The gate archives the actual tracked and non-gitignored candidate files, not a separately fetched upstream checkout. It excludes Git metadata, local evidence and ignored dependencies, streams the archive without mounting credentials or the host filesystem, and records the archive SHA256 and image ID. The image build context is empty. The disposable container is removed after the run; normal local image cache remains.

Tests load the actual installed Pi SDK and TypeScript extension. Set `PI_SDK_PATH` to its `dist/index.js` if the `pi` executable is a wrapper rather than the normal Node installation. No model calls occur in deterministic tests.

Live evaluation is explicit and uses authenticated accounts:

```sh
node pi/verification/eval.mjs --live --model openai-codex/gpt-6-astra
```

Use `--case small`, `routing`, `off`, `tdd`, `investigation`, or `workers` for one required case. The optional `--case claude` checks the Claude transport separately; authentication or quota failures are reported as blocked, not passed. It creates private disposable workspaces and a separate Pi agent directory, links existing auth/model-store files without copying secrets, and records a report with versions, commands, model usage and evidence paths. It disables unrelated Pi extensions, context files and automatic project trust. `PI_PSTACK_ISOLATED=1` propagates those isolation flags to Pi children. OAuth refresh can still update the existing credential store through the link. No production files or remote PRs are touched.

Workflow cases explicitly map aliases to the chosen Pi model. That tests delegation and playbook behavior, **not model diversity**. The workers case launches three distinct Pi models concurrently and verifies the model identities in their actual responses. Its defaults are GPT-6 Astra, Sol, and Luna; choose explicit alternatives with `--model`, `--peer-model`, and `--third-model`. The separate Claude case keeps its normal account and plugin environment; it is an integration test, not a clean-room test.

Assertions cover small-task bypass, an automatic unknown-bug routing probe (intentionally stopped after loading `poteto-mode`, not counted as a completed bug fix), routing off, an actual red/green TDD change, the complete read-only Investigation playbook with `how` delegation and output evidence, and independent multi-model Pi workers. The Claude transport has a separate optional live gate; do not configure it for production while that gate is blocked. A successful smoke test is not a claim that every upstream playbook works. Shipping, Graphite stacks, browser/UI driving, skill-authoring companions, and multi-day orchestration require their own dependencies and scenario-specific validation. See `verification/RESULTS.md` for measured results and remaining coverage.

## Update upstream

Do not run an unreviewed remote install/update script. Work on a candidate branch:

```sh
git fetch upstream
git switch -c chore/upstream-candidate
git merge --no-ff upstream/main -m 'chore(upstream): incorporate upstream release'
```

If upstream introduces `pi/`, stop and resolve ownership deliberately. Do not overwrite it. Update only `pi/upstream.json` to the incorporated full SHA and its `VERSION`, then:

```sh
node pi/check.mjs
node pi/verification/eval.mjs --live --model openai-codex/gpt-6-astra
```

Review changed tool names, roles, model defaults, hook behavior, agent definitions and referenced scripts. Green Git merges do not imply semantic compatibility. Adjust only `pi/`; any upstream-file patch needs explicit approval. Publish the fork PR with exact evidence, then update the `fede` submodule pin in a separate validated PR. The integrity check compares against the new pin and rejects any drift outside `pi/`.

The unchanged upstream GitHub workflows do not run the Pi suite. Run the **complete** `node pi/check.mjs` gate (with `--container podman` or `docker` where needed) and the live evaluations; attach the evidence summary to the fork PR. A smaller passing subset or green CI on a different upstream checkout does not satisfy the candidate gate. Keeping all additions inside `pi/` avoids changing upstream workflows.

## Disable and roll back

`/pstack off` is immediate for routing. To remove the integration entirely:

```sh
pi remove /absolute/path/to/pstack-claude/pi
```

Restart Pi or use `/reload`. Other runtimes are unaffected because this package does not install symlinks into shared skill directories. Preserve or remove private evidence separately; uninstall does not delete it or credentials.

To roll back a release, restore the previously validated fork commit/submodule pin and reload Pi. Keep `pstack.json` backed up before changing model mappings. A local-path install follows the checked-out tree, so never point your production installation at an actively edited worktree.

## License

The additive Pi adapter uses the repository's MIT license. Original skill attribution and notices remain unchanged in the upstream tree.
