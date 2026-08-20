## Scope

- Base commit SHA:
- Head commit SHA:
- Approved task:
- Exact changed files:
- Change classification: `SAFE_CANDIDATE` / `CRITICAL` / `UNKNOWN`
- Critical/unknown reasons:

## Verification

- [ ] Work performed in a clean isolated worktree
- [ ] Targeted tests passed (never used instead of full regression)
- [ ] Full regression passed: packages / assertions
- [ ] Localhost HTTP + Playwright Chromium integration passed
- [ ] Production JavaScript syntax passed
- [ ] `git diff --check` and untracked whitespace passed
- [ ] Workflow YAML parsed successfully, if applicable
- [ ] PR file scope matches the approved list
- [ ] Diagnostic reports are excluded unless explicitly approved
- [ ] `structureHistoricalReplayBinancePager.js` user change is excluded unless explicitly approved

## Safety gates

- [ ] PR starts as draft
- [ ] No secret or write token is exposed to PR code
- [ ] Critical/unknown changes are marked for human review
- [ ] Workflow, security, dependency, and policy changes are not auto-merge eligible
- [ ] Source branch deletion is disabled
- [ ] Merge method, if later authorized, is merge commit

## Rollback

- Expected merge commit:
- Revert command: `git revert -m 1 <merge-commit-sha>`
- Rollback verification plan:
