# HNDai repository agent rules

These rules apply to every file in this repository.

## Scope and ownership

- Start work from the exact user-approved `origin/main` commit in a clean, isolated Git worktree.
- Before editing, record `git rev-parse --show-toplevel`, `git rev-parse HEAD`, and `git status --short`.
- One agent owns one mutable worktree. Codex, Claude, or any other agent must not edit the same worktree concurrently.
- A second reviewer must use a separate clean clone/worktree pinned to the PR head SHA.
- Do not modify, stage, discard, or overwrite unrelated user changes.
- Treat `js/hndai-v1/structureHistoricalReplayBinancePager.js` as user-owned unless the user explicitly puts that exact file in scope.
- Diagnostic reports matching `*-raporu.md` are commit-excluded by default. Stage one only when the user explicitly names that report for publication.

## Editing and staging

- Keep changes limited to the approved file list. Stop if a required change materially expands scope.
- Never use `git add .`, `git add -A`, or `git add --all`.
- Stage only explicitly approved paths with `git add -- <paths>` after reviewing staged and unstaged diffs.
- Do not delete source branches automatically.
- Do not create commits, push, open/update PRs, merge, or change repository settings without separate explicit authorization.
- Start PRs as drafts unless the user explicitly requests review-ready state.
- Use merge commits when merge is authorized.

## Verification

- Run relevant targeted tests first; targeted tests never replace the full regression suite.
- Run `npm run test:full`, `npm run test:browser`, `npm run check:syntax`, and `npm run check:whitespace` before requesting publication approval.
- Browser integration must use a real localhost HTTP server and Playwright Chromium. Missing browser support is a failure, not a skip.
- Verify workflow YAML parses before publication.
- Run the change classifier for the actual diff. `CRITICAL` or `UNKNOWN` is never auto-merge eligible.
- Perform final verification in a clean worktree/check-out at the exact source commit.

## Safety boundaries

- Never infer or synthesize live trading, risk, entry, stop-loss, take-profit, readiness, authorization, or secret values.
- Changes to trading execution, exchange APIs, secrets, leverage, position sizing, risk, SL/TP, live readiness, authorization, workflows, security policy, destructive behavior, dependencies, or unknown paths require human review.
- Fail closed on missing evidence, ambiguous scope, incomplete tests, stale SHA, unavailable dependencies, or conflicting classification.
- CI and review automation must not expose secrets or write tokens to pull-request code.

## Reporting

- Report the exact source SHA, changed files, diff summary, targeted/full assertion totals, browser result, syntax count, whitespace result, and classifier result.
- Preserve evidence that unrelated user changes and diagnostic reports remained outside the change.
- Copy only the explicitly requested current report to the real desktop and verify source/target `Test-Path` plus SHA256 equality.
