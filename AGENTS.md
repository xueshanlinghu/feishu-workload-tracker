# AGENTS

## Documentation

- `README.md` should stay focused on end-user usage: setup, configuration, deployment, and day-to-day operation.
- Implementation details, investigation notes, debugging findings, API quirks, and engineering experience should be written into the appropriate file under `docs/`, not into `README.md`.

## Release & Deployment

- Follow the release flow on the existing long-lived branches: finish the change on `dev`, validate locally, then merge `dev` into `master` for the formal release.
- Before a release, run at least `npm run lint` and `npm run build`, and mention clearly if production-only verification could not be completed from the current environment.
- Use the established release commit and tag pattern:
  - merge commit on `master`: `Merge branch 'dev' into master - Release vX.Y.Z`
  - annotated tag: `vX.Y.Z`
- After pushing `master` and the tag, always create or update the GitHub Release explicitly. A Git tag alone does not count as a published release.
- GitHub Release notes should follow the repository's recent style in Chinese and normally include:
  - a short title paragraph or summary line
  - `### 主要更新`
  - `### 部署说明`
  - `### 验证版本`
  - `Full Changelog` compare link
- If the current machine does not have Docker or direct production access, complete the code release steps that are possible, then state clearly that container rebuild / restart / health check still need to be executed on the production host.
