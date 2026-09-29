# Evaluation record

## Promotion candidate: upstream 0.9.50

- Upstream: `5c036ce3d91defda49d436f3659242934b7f90c4`.
- Clean implementation revision tested: `91c6c61960267967cad0a6aad4f6f67647c0fb79`.
- Pi 0.87.1; Claude CLI 2.1.284; Node 24.18.0; macOS arm64.
- Live run: 2026-09-29 03:33:14–03:36:34 UTC, with `adapterDirty: false`.
- `node pi/check.mjs`: **21 adapter tests and 372 upstream tests passed**;
  generator, pinned-tree integrity, original skills/agents and references passed.
- TypeScript compilation against the installed Pi SDK passed. Markdown correctness
  lint for `pi/**/*.md` passed.

| Live case | Result | Evidence checked |
| --- | --- | --- |
| Small task | Passed | Correct answer with no tool calls |
| Automatic routing | Passed | Unknown-cause multi-file bug loads original `poteto-mode` |
| Routing off | Passed | Architecture answer with no automatic skill invocation |
| TDD | Passed | Actual failing Node assertion before source fix, then passing test |
| Complete Investigation | Passed | `poteto-mode`, `how`, independent worker, source-backed output, throughput checkpoint, `unslop`, unchanged sources |
| Parallel models | Passed | Separate Astra, Sol and Luna processes, actual matching response identities |

The routing probe intentionally terminates immediately after loading the skill.
It proves routing, **not completion of a bug-fix playbook**. The complete playbook
covered here is read-only Investigation. Workflow cases explicitly use single-model
alias overrides; model diversity is established only by the separate parallel case.

Reported consumption, including observed delegated-worker usage: 41 usage records,
120,684 input tokens, 3,995 output tokens, 406,016 cached-read tokens, 530,695 total.
Provider-reported estimated cost: **USD 1.647894**, not an invoice. An interrupted
routing call can have unreported consumption. Earlier exploratory evaluations and
the independent review are not included in those totals.

Original report directory:
`/var/folders/1k/n2_sthps4fx4r6bkkfnsgpkr0000gn/T/pstack-eval-P3caWi/`.
A private local copy of reports, event streams, sessions and delegated results is
in `pi/verification/local-evidence/0.9.50/` (gitignored). No credential files or
credential symlinks are included. Fresh runs print their own evidence directory.

## Actual upstream-update exercise

Started with 0.9.49 at `540aa77fd7c4195acb77d67cebff3ff984308af7` and committed
only `pi/`. Fetched and merged 0.9.50 on the candidate branch without conflicts.
The old pin correctly failed the integrity gate. After updating `pi/upstream.json`,
the gate and all six live cases passed. `git diff <new-pin> -- . ':(exclude)pi'`
is empty. No upstream file was hand-patched or regenerated differently.

Review of the upstream delta included the `how` Task-to-Agent translation and
script changes. Pi's existing delegation mapping covers that translation.
The fork's `main` remains an unmodified fast-forward mirror of upstream; the
adapter is published through its own PR.

## Independent review and negative tests

A separate, read-only GPT-6 Sol reviewer examined the actual adapter. Findings
about top-level SIGTERM cleanup, missing/wrong model identity, settled-only
completion, timeout escalation, stderr classification, and early PASS reporting
were addressed. Deterministic regression tests cover cancellation, parallelism,
failed/malformed processes, denied permissions, model substitution, and limits.
SDK tests load the actual TypeScript extension, discover all 54 original skills,
exercise routing toggles, and verify active-branch history excludes abandoned data.

An earlier live assertion rejected valid direct entry to `how`. Upstream explicitly
allows specific-intent entry; the runner now separates the routing probe from the
explicit complete-playbook test. This was an evaluation-design correction, not a
rewrite of upstream policy.

## Blocked and unverified capabilities

- **Claude execution is blocked by the account's weekly limit.** A real Sonnet
  invocation failed visibly; no Pi substitution occurred. The separate final
  transport test also exits nonzero with `blocked`. Do not enable Claude aliases
  in production until `--case claude` passes with that account. The default Pi
  integration can use the three independently validated Codex models instead.
- Additional upstream script checks: typecheck and Prettier passed; **153/154
  `orch`/`watch-pr` tests passed locally**. The macOS transport deadline fixture
  times out before creating its PID file (reproduced with Bun 1.3.11 and 1.3.14).
  It was not patched or suppressed. The exact upstream pin's
  [canonical CI passed](https://github.com/michael-denyer/pstack-claude/actions/runs/36516759304).
  This is outside the Pi adapter's required root-test gate, but remains a local
  limitation of shipping-workflow verification, not a passing test.
- Native Claude collision smoke tests are unavailable under the same quota.
- Graphite shipping, live GitHub merge-safety exercises, browser/UI drivers,
  skill-authoring companions, durable multi-day orchestration and Windows
  process-tree behavior are unverified. No unit test substitutes for those flows.

Raw Claude evidence: `pstack-eval-toRTgD/report.json` under the same temporary
parent. Earlier quota evidence and exploratory runs remain separate from the
clean-candidate promotion results.
