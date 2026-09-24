---
name: release
description: Release a new Headway version — test, pick the semver bump, write the CHANGELOG section, bump every version file, commit, tag v<version> and push. Use when the user types /release or asks to cut, ship or publish a Headway release. Optional argument: "major", "minor", "patch" or an exact version such as 1.2.0.
---

# Release Headway

Pushing the tag `v<version>` starts `.github/workflows/release.yml`. That workflow builds
the installers and publishes the GitHub release. The release body is this version's
`CHANGELOG.md` section, printed by `scripts/release-notes.mjs`, and the build fails if
that section is missing. After an update, the app's "What's new" dialog shows the same
section. So the CHANGELOG section is the release notes: write it for users.

Do these steps in order and stop on any failure.

1. **Preflight.** Check that you are on `main` and that `git status` shows nothing
   unexpected. If files are uncommitted, ask whether they belong in the release. Other
   sessions may be editing the tree, so never `git stash`. Run `git fetch` and make sure
   `main` is not behind `origin/main`.

2. **Test.** Run `make test`. If anything fails, stop and report the failure. Never
   release a red build.

3. **Pick the version.** The last release is `git describe --tags --abbrev=0`. The
   default bump is a patch. Use the user's argument if they gave one (`major`, `minor`,
   `patch` or an exact `X.Y.Z`). The new version must be higher than the last tag.

4. **Write the release notes.** Read everything since the last tag: `git log <last-tag>..HEAD`
   plus any uncommitted changes going into the release. In `CHANGELOG.md`, add a new
   `## <version> — <YYYY-MM-DD>` section at the top, above the previous version.
   - If there is a `## Unreleased` section, use it as the base of the new section.
     Rename it, then tighten and complete it from the git log. Do not leave an empty
     `## Unreleased` behind.
   - Use short sections (`### New`, `### Improved`, `### Fixed`, only the ones needed),
     each with bullets. Give each notable change a bold title followed by a short,
     impactful description and a use case, e.g.
     `- **Jira Cloud sync**: link a plan to a Jira project so features push to issues and status flows back.`
   - Leave out internal-only changes (chores, refactors, tests, CI, docs about the repo).
   - Check the result: `node scripts/release-notes.mjs <version>` must print the section.

5. **Bump the version** to `<version>` in all four places, and nowhere else:
   - `package.json` → `"version"`
   - `package-lock.json` → the top-level `"version"` and `packages[""].version`
   - `src-tauri/Cargo.toml` → `version` under `[package]`
   - `src-tauri/Cargo.lock` → the `version` of the `name = "headway"` entry

   `src-tauri/tauri.conf.json` reads its version from `../package.json`, so do not edit it.
   Edit only these entries. Other packages in the lockfiles can have the same version
   number by coincidence, so a blind search-and-replace would change the wrong lines.
   Check with `git diff --stat`: it should show exactly one changed line in
   `package.json`, `Cargo.toml` and `Cargo.lock`, and two in `package-lock.json`.

6. **Commit, tag and push.**
   - `git add CHANGELOG.md package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock`
   - `git commit -m "release: v<version>"`, ending with the attribution trailer
   - `git tag v<version>`
   - `git push origin main` then `git push origin v<version>`

7. **Report.** Give the version, the tag, the release notes you wrote, and the Actions
   run URL for the tag from `gh run list --workflow release.yml --limit 1`, if `gh` is
   available. Do not wait for the build unless the user asks you to.
