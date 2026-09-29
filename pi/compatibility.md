# PStack on Pi

These instructions translate runtime mechanics, not PStack policy. Follow the original skills and playbooks. User instructions and repository rules take precedence, including approval, orchestration, and safety boundaries. PStack does not grant permissions for unrelated external actions.

## Tools and skills

- Claude `Skill` / `pstack:<name>` means `pstack_skill` with that name, or read the original SKILL.md. Resolve references from the returned skill directory. `/skill:<name>` is the Pi user command. Do not use the Codex mapping on Pi.
- Claude `Agent` / Task delegation means `pstack_agent` with action `start`, the original prompt, `agent` equal to its subagent_type, `model`, and an explicit `cwd`. It returns a worker ID immediately. Start independent workers before waiting. Use `wait`, `status`, and `stop` with that ID; completed means the process exited. Review the result and diff yourself. Use separate worktrees for concurrent writers. A worker has normal CLI tool/permission configuration, NOT a filesystem sandbox.
- `pstack_runtime` lists available Pi models and configured alias/role mappings. Pass upstream model aliases only when configured. `claude:<model>` explicitly uses Claude CLI and its own permissions, tools and MCP configuration; it does not inherit Pi MCP integrations. No fallback model is selected on failure. For different-family review, ensure actual model diversity. Never replace it with self-review or silently reuse one model.
- Role settings live in the Pi agent directory's `pstack.json`, not Claude/Codex configuration. `models` maps upstream aliases to exact `provider/model-id` or `claude:<model>` values; `roles` maps role names to model values. For a role override use it instead of the skill default. Otherwise use the skill's declared default. `auto` and `inherit-parent` inherit the coordinator's Pi model. Effort is the `thinking` argument, separate from model. Strip an upstream `@level` suffix and pass it there. Effect-specific agent names are supported, but pass their intended effort explicitly. Never claim an untested alias is available just because it is in a catalog.
- `AskUserQuestion` means ask the user directly and wait. In noninteractive workers, return the question as blocked. No answer is implied.
- For `TaskCreate`/`TaskUpdate`/`TodoWrite`, use the upstream fallback: an uncommitted `todo.md` in the work directory. Do not create a persistent Pi goal unless the user requested one.
- Use native Pi read, edit, write, bash, and discovered MCP tools. Discover MCPs through the Pi MCP gateway, not `claude mcp list`. Do not assume workers share coordinator MCP access; verify the source tools in that worker or report blocked coverage.

## History and drivers

- Use `pstack_runtime` for the current session file, ID, project session directory, and paginated active-branch history. Pi transcripts are JSONL trees: message entries have type `message` and a nested `message`; not every record is a message. The active-branch export excludes abandoned branches and keeps pre-compaction evidence. Do not run Claude transcript-finder scripts against Pi history.
- For recall of older sessions, search only the reported project session directory. Check each session header's cwd before reading its messages. Never broaden to another project without explicit user authorization. Worker transcripts and complete JSON events are at the paths returned by `pstack_agent`.
- `setup-pstack` on Pi uses `pstack_runtime` discovery and asks the user before writing the Pi `pstack.json`. It must not modify CLAUDE.md or Codex settings. `/pstack on` and `/pstack off` toggle routing for the current session; persist `routing` in pstack.json for future sessions.
- Claude's bundled `run`, `drive`, `loop`, and `plugin-dev:skill-development` are not supplied by this package. Use an installed equivalent only after reading it and verifying its capability. For a CLI, direct bash execution on the real artifact can supply driving evidence. UI/browser verification needs a real driver; absent one, report blocked rather than substituting unit tests. Skill-authoring workflows require available authoring guidance and behavioral evaluation, not a fake plugin invocation.

## Limits and lifetime

Workers are session-owned, at most eight concurrent per coordinator and three delegation levels deep. A capacity/depth error is a visible blocker, not permission to skip delegation. They stop when the parent session switches, reloads, exits, or is cancelled at a wait. They are not durable daemons; long-running orchestration must checkpoint and explicitly resume in a new session. Start does not imply completion, and wait timeout does not imply failure. Do not claim completion until the worker status and required evidence support it.
