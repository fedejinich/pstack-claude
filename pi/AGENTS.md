# Pi adapter boundary

Keep every upstream file outside `pi/` byte-for-byte identical to the commit in
`upstream.json`. Do not copy or rewrite skills. Ask before changing that boundary.
Use the installed Pi extension/SDK documentation for runtime contracts.

From the repository root, run `node pi/check.mjs`. Live model evaluations are a
separate opt-in: `node pi/verification/eval.mjs --live`. Preserve evidence and
report blocked/untested capabilities honestly. Do not install candidate changes
into global Pi configuration until the required checks pass.

Keep adapter tests in `pi/verification/`, not a directory named `tests`: upstream
Bun test filtering would include Node-only Pi SDK tests. Upstream updates require
both suites and live evals before promoting the monorepo pin. See `README.md`.

Use conventional commit and PR titles: `type(scope): description`.
