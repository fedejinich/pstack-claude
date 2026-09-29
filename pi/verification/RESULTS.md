# Evaluation record

## Promotion candidate: upstream 0.9.50

- Upstream: `5c036ce3d91defda49d436f3659242934b7f90c4`.
- Clean implementation revision tested: `91c6c61960267967cad0a6aad4f6f67647c0fb79`.
- Pi 0.87.1; Claude CLI 2.1.284; Node 24.18.0; macOS arm64.
- Live run: 2026-09-29 03:33:14–03:36:34 UTC, with `adapterDirty: false`.
- Complete candidate gate: `node pi/check.mjs --container podman` passed **22
  local Pi adapter tests, 372 upstream root tests and all 154 `orch`/`watch-pr`
  tests**, plus generator, pinned-tree integrity, references, typecheck and format.
  The upstream suites ran as a non-root Linux arm64 user on Node 22.19.0 / Bun
  1.3.14. The archive contained the actual candidate, not a fresh upstream copy.
  Final committed-candidate logs and archive/image digests are retained with the
  PR's promotion evidence.
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

## Audit correction: complete gate before promotion

The first completion audit correctly rejected promotion: the earlier gate omitted
`orch`/`watch-pr`, and a known failure in that applicable suite had been treated as
optional. Initial global activation was premature. The package and its active
configuration were removed, and both PRs were converted to drafts.

The corrected gate includes every deterministic upstream suite. A pinned,
non-root Linux container resolves the host-specific deadline fixture without
changing upstream code. It tests actual candidate bytes, records their archive
hash and the image ID, and excludes credentials and private evidence. The image
has Node, Bun, Git and Python, matching the tools the unchanged suites need.
Initial container setup errors (missing dependencies and macOS archive metadata)
were corrected in the harness, not in upstream tests. The subsequent complete
run passed, including the previously failing deadline test. Native macOS failure
is preserved in the evidence rather than misrepresented as a pass.

Repromotion requires the corrected gate on the published candidate and its live
Pi evaluations. Final activation and PR state are recorded in the PR comments.

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
- The native macOS transport deadline fixture times out before creating its
  PID file (153/154 passed on Bun 1.3.11 and 1.3.14). **It is required**, not an
  optional exception: the complete candidate gate now runs it successfully in
  Linux, with all 154 passing. No test was patched, omitted, retried until lucky,
  or given a longer timeout. This validates the deterministic shipping scripts,
  not an actual GitHub shipping workflow.
- Fork Actions produced no runs after enablement and push. Dispatch returned 422
  because the untouched upstream workflow lacks `workflow_dispatch`. This is not
  reported as green CI. The complete local candidate gate supplies the evidence;
  canonical upstream CI alone would not establish candidate correctness.
- Native Claude collision smoke tests are unavailable under the same quota.
- Graphite shipping, live GitHub merge-safety exercises, browser/UI drivers,
  skill-authoring companions, durable multi-day orchestration and Windows
  process-tree behavior are unverified. No unit test substitutes for those flows.

Raw final Claude evidence: `pstack-eval-rqg1Xq/report.json` under the same temporary
parent. Its synthetic API-error message initially masked the quota as an identity
mismatch. A Claude-only event-filter fix and regression test preserve the actual
quota error without accepting a synthetic model as verified. The final live retry
reports `blocked`; it does not claim successful Claude execution. This small fix
postdates the clean six-case Pi run above; Pi execution paths are unchanged.
Earlier quota evidence and exploratory runs remain separate from promotion results.
