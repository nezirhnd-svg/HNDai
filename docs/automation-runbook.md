# HNDai automation runbook

## Purpose

This runbook covers read-only CI, change classification, merge evidence, incident handling, and rollback. It does not authorize auto-merge, Claude integration, repository setting changes, or production trading changes.

## Standard PR flow

1. Record the approved `origin/main` SHA and create a separate feature worktree.
2. Confirm the worktree is clean before editing.
3. Keep the exact approved file scope. Preserve unrelated user changes and diagnostic reports.
4. Run targeted tests, full regression, browser integration, syntax, whitespace, and classification.
5. Create a draft PR only after separate publication authorization.
6. Compare the PR file list with the approved scope.
7. Treat `CRITICAL` and `UNKNOWN` as human-review-only.
8. Require all configured CI checks on the exact PR head SHA.
9. Use a merge commit only after explicit merge authorization. Do not delete the source branch.

## Local commands

```powershell
npm ci
npm run test:targeted -- --base <base-sha> --head <head-sha>
npm run test:full
npm run test:browser
npm run check:syntax
npm run check:whitespace -- --base <base-sha> --head <head-sha>
npm run check:classify -- --base <base-sha> --head <head-sha>
```

Targeted tests are an early signal and never replace `test:full`.

## Required merge evidence

- Repository and PR URL.
- Base, source, tested head, and merge commit SHA.
- Exact changed file list and diff summary.
- Change classification and reasons.
- Targeted package/assertion result and whether it fell back to full.
- Full package/assertion result.
- Browser integration result and browser version.
- Production syntax file/failure count.
- Whitespace and `git diff --check` result.
- Required GitHub check conclusions for the tested head SHA.
- Confirmation that the source branch was preserved.

## Fail-closed response

Stop without merging when any of these occurs:

- Base/head SHA is missing, stale, or differs from the tested SHA.
- Classification is `CRITICAL` or `UNKNOWN` for an automatic path.
- A required job fails, is skipped, cancelled, times out, or is absent.
- Package/assertion totals cannot be parsed.
- Playwright or Chromium is unavailable.
- Workflow YAML cannot be parsed.
- File scope contains an unapproved path, report, secret, symlink, binary, rename, or deletion.
- Branch protection is not active when a protected merge is claimed.
- Claude or another reviewer is unavailable but a second review is claimed.

## Incident and kill switch

1. Disable any write-capable automation workflow from GitHub Actions settings.
2. Disable repository auto-merge if it was enabled in a later phase.
3. Revoke the affected GitHub App installation or credential.
4. Preserve workflow run URLs, job logs, actor, event payload metadata, and SHAs.
5. Open a human-reviewed remediation PR. Never patch `main` directly.

## Rollback

For a merge commit, create a dedicated rollback branch from current `origin/main`:

```powershell
git fetch origin main
git switch -c rollback/<short-description> origin/main
git revert -m 1 <merge-commit-sha>
npm ci
npm run test:full
npm run test:browser
npm run check:syntax
npm run check:whitespace
```

Push and PR creation require separate authorization. The rollback PR must pass the same required checks. Do not rewrite history or force-push `main`.

## Minimum permissions

- Test and classification workflows: `contents: read` only.
- No secrets in pull-request test jobs.
- Any future merge automation must be separate, must not execute PR code, and must use a repository-scoped short-lived token.
- Personal broad-scope PATs are prohibited for automation.
- Workflow and security-policy changes always require human review and are never auto-merge eligible.
