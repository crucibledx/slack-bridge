# Loop contract

Read by the Crucible loop agents (`implement-spec`, `verifier`, `spec-writer`). Keep it accurate.

- **Install:** `bun install --frozen-lockfile` (Bun version in `.bun-version`).
- **Checks** (all must pass before a PR is ready; CI runs the first five as `ci / quality`, `ci / test` and
  `ci / build`):
  - format: `bun run format:check`;
  - lint: `bun run lint`;
  - typecheck: `bun run typecheck`;
  - tests: `bun test`;
  - build: `bun run build` (`wrangler deploy --dry-run --outdir dist`, deploys nothing);
  - workflows: `actionlint .github/workflows/*.yml`;
  - JSON: `python3 -m json.tool .factory/settings.json`.
- **Commit style:** `chore: ...`, `feat: ...`, `fix: ...`, `docs: ...`, `spec(NNNN): ...`, matching `git log`.
- **Specs:** `specs/NNNN-slug.md`, see `crucibledx/hq` `specs/README.md`.
- **Secrets:** GitHub Actions secrets and Worker secrets only. No secret in the repo, logs, fixtures or PR text.
- **Deploy:** `.github/workflows/deploy.yml`, only on push to `main` and `workflow_dispatch` on `main`, never for
  pull requests. Merging to `main` deploys the Worker.
- **Release:** manual. Loop PRs never bump versions, tag, or publish.
