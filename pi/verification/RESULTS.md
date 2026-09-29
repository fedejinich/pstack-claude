# Evaluation record

## Candidate baseline: upstream 0.9.49

Upstream SHA: `540aa77fd7c4195acb77d67cebff3ff984308af7`.

- Pi 0.87.1; Claude CLI 2.1.284; Node 24.18.0.
- Deterministic adapter checks: 21 passed after review fixes.
- Upstream generator and 357 upstream tests passed before the update.
- Exploratory live run: `/tmp/pstack-eval3.log`, evidence directory
  `/var/folders/1k/n2_sthps4fx4r6bkkfnsgpkr0000gn/T/pstack-eval-Rulu4e/`.
  Small-task bypass, automatic routing probe, routing off, red/green TDD,
  complete Investigation playbook, and concurrent Astra/Sol/Luna workers passed.
  This run overlapped final hardening edits; it is not a clean-revision promotion gate.
- Earlier investigation routing assertion was too strict: upstream permits direct
  entry to `how` for specific questions. The runner now tests automatic unknown-bug
  routing separately and tests the complete Investigation playbook explicitly.
- A read-only GPT-6 Sol review found signal cleanup, identity verification,
  completion-event validation, timeout escalation, and reporting issues. They were
  addressed with code changes and regression tests. Review evidence:
  `/tmp/pstack-review.jsonl`.

## Blocked optional transport

A real Claude Sonnet worker returned: "You've hit your weekly limit". No fallback
was used. This demonstrates failure reporting, not successful Claude execution.
Do not select Claude aliases in production until a separate live transport test
passes. Evidence: `pstack-eval-KuU1Uo/report.json` under the same temporary parent.

## Pending promotion gate

Upstream 0.9.50 appeared during development. Its actual incorporation, integrity
check, and clean-candidate live evaluations must complete before installation.
Production configuration has not been changed.

## Coverage limits

The complete playbook tested is read-only Investigation, not shipping a PR.
Graphite, browser/UI workflows, skill-authoring companions, long-running durable
orchestration, Windows process-tree behavior, and successful Claude execution
remain unverified. Missing dependencies are not treated as passing evidence.
