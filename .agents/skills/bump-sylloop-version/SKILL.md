---
name: bump-sylloop-version
description: Analyze Sylloop release changes and recommend the next stable semantic version, then prepare a version-update branch and draft pull request only after exact user confirmation. Use when asked to choose, bump, upgrade, synchronize, or prepare the next Sylloop version or release PR. Never merge a PR, create or move a tag, or publish a GitHub Release.
---

# Bump Sylloop Version

Prepare version changes in two strictly separated phases: read-only analysis, then confirmed execution.

## Analyze without modifying tracked files

1. Confirm the repository is Sylloop and read its root `AGENTS.md`.
2. Fetch current release facts without changing tracked files:

   ```powershell
   git fetch origin main --tags
   node .agents/skills/bump-sylloop-version/scripts/collect-release-context.mjs
   ```

   If network access or GitHub authentication is unavailable, stop instead of making a recommendation from stale remote state. Use `--offline` only for tests or when the user explicitly accepts local-only evidence.
3. Inspect the collector output, `CHANGELOG.md`, and the actual patch from `baseTag..origin/main`. Do not infer release impact from commit prefixes alone.
4. Check existing release branches, pull requests, tags, and GitHub Releases. Stop on an existing release attempt for the proposed version rather than overwriting it.
5. Recommend the highest applicable outcome:
   - No release: only documentation, tests, or CI changes that do not alter a delivered application or installer.
   - PATCH: bug, security, performance, localization, shipped dependency, or installer fixes.
   - MINOR: user-facing features, supported formats, important preferences, or significant behavior changes.
   - MINOR during `0.x`: any breaking user compatibility change.
   - MAJOR from `1.x`: any breaking user compatibility change.
   - First release: when there is no stable tag or GitHub Release and all manifests are `0.1.0`, recommend `0.1.0`, not `0.2.0`.
6. Treat supported media, persisted preferences, installer identity, minimum OS requirements, and established user workflows as the compatibility contract. Cache invalidation alone is not breaking when user data remains safe.
7. Report the base tag, full `origin/main` SHA, grouped user-visible changes, recommended bump, exact version, decisive evidence, and credible alternatives.
8. Ask for confirmation and end the turn. Provide this exact reply form with the analyzed short SHA:

   ```text
   $bump-sylloop-version 确认 X.Y.Z，基于 abc1234
   ```

Do not edit files, create or switch branches, commit, push, or open a PR before that confirmation.

## Validate confirmation

1. Require an exact stable `X.Y.Z` and the analyzed SHA. Treat vague approval as insufficient.
2. Fetch `origin/main` and tags again, rerun the collector, and compare the confirmed SHA, latest stable tag, and manifest versions with the prior analysis.
3. Invalidate the confirmation and return to analysis if any release input changed.
4. Reject invalid, duplicate, or lower-than-current versions.
5. Accept a higher bump than recommended. If the user selects a lower bump, explain the compatibility risk and require a second reply containing `强制确认 X.Y.Z` before continuing.
6. Require a clean worktree. Never discard, reset, stash, or overwrite user changes.

## Prepare the draft release PR

1. Ensure no local or remote `codex/release-vX.Y.Z` branch, `vX.Y.Z` tag, matching pull request, or GitHub Release exists.
2. Create `codex/release-vX.Y.Z` from the confirmed `origin/main` commit.
3. Run `npm run version:set -- X.Y.Z`, then `npm run version:check`.
4. Update `CHANGELOG.md`: move `Unreleased` entries into `## [X.Y.Z] - YYYY-MM-DD`, add concise English user-facing bullets when needed, leave a new empty `Unreleased`, and update comparison and release links. For the first `0.1.0` release, preserve the existing section and correct its intended publication date if needed.
5. Run the required local checks:

   ```powershell
   npm test
   npm run build
   Push-Location src-tauri
   cargo fmt --all -- --check
   cargo clippy --all-targets --locked -- -D warnings
   cargo test --locked
   Pop-Location
   ```

6. If any check fails, stop before committing and report the failure. Do not weaken checks or modify unrelated behavior.
7. Review `git diff` and stage only `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and `CHANGELOG.md`.
8. Commit with `chore(release): prepare vX.Y.Z` and push the release branch.
9. Create a draft PR to `main` with the same title. Include the recommendation rationale, user-visible changes, commands run, commands not run, and the manual post-merge annotated-tag step.
10. Read and report the PR checks. Keep the PR draft even when checks pass.

If authentication, push, or PR creation fails, preserve the safe local branch and commit, state the exact stopping point, and do not claim the PR exists.

## Stop boundary

Never merge or mark the PR ready, create or move `v*` tags, publish or edit GitHub Releases, replace release assets, or bypass CI. Those actions happen only after separate user direction and a green `main` CI run.
