# Loop contract

Read by the Crucible loop agents (`implement-spec`, `verifier`, `spec-writer`). Keep it accurate.

- **Install:** nothing yet. The Worker skeleton PR adds the install command and the `format:check`, `lint`,
  `typecheck`, `test` and `build` checks here.
- **Checks** (all must pass before a PR is ready):
  - workflows: `actionlint .github/workflows/*.yml`;
  - JSON: `python3 -m json.tool .factory/settings.json`.
- **Commit style:** `chore: ...`, `feat: ...`, `fix: ...`, `docs: ...`, `spec(NNNN): ...`, matching `git log`.
- **Specs:** `specs/NNNN-slug.md`, see `crucibledx/hq` `specs/README.md`.
- **Secrets:** GitHub Actions secrets and Worker secrets only. No secret in the repo, logs, fixtures or PR text.
- **Deploy:** only on push to `main`, never for pull requests. Merging to `main` deploys the Worker once the deploy
  workflow exists.
- **Release:** manual. Loop PRs never bump versions, tag, or publish.
