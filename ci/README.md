# `ci/seo.yml` — one command from being active

This is the SEO guardrail workflow (what it does: `CHANGE-A-PRICE.md` → *"What CI does
so you don't have to"*). It lives here rather than in `.github/workflows/` for one
reason only: **GitHub Actions only runs workflows from `.github/workflows/`, and the
automation token used to prepare this branch is not allowed to write there** — the
push is rejected with *"refusing to allow a GitHub App to create or update workflow
`.github/workflows/seo.yml` without `workflows` permission"*.

Writing to that path is a permission a repository owner has to grant deliberately, so
the last step is yours.

## Activate it

```bash
git checkout arena/01a06c9c-valmont-data        # or main, once the PR is merged
mkdir -p .github/workflows
git mv ci/seo.yml .github/workflows/seo.yml
git commit -m "CI: activate the SEO guardrails (pages-in-sync + weekly production audit)"
git push
```

Then check the **Actions** tab: `SEO` should appear, and you can run the production
audit immediately with *Run workflow* (it accepts a base URL, defaulting to
`https://valmontdata.com`).

Nothing else needs to change — the workflow has no dependencies to install (the repo
has none), and both jobs run in seconds.

## Or grant the permission and let me do it

Repository **Settings → Actions → General**, or the Arena GitHub App's installation
permissions for this repo: enable **Workflows: read and write**. Say the word and I
will move the file, push it and confirm the first run.

## What the two jobs do

| Job | Runs | Fails / reports when |
| --- | --- | --- |
| `pages-in-sync` | every PR, every push to `main` | the committed landing pages differ from what `scripts/generate-seo-pages.js` produces from the catalogue — i.e. a price or bundle changed and nobody re-ran the generator. Prints the fix command. Also runs the 96-check SEO suite. |
| `production-audit` | Mondays 06:17 UTC, or *Run workflow* | the pages **published on the live site** disagree with the **live catalogue** — typically a price edited straight into the Supabase SQL editor with no git commit. Opens one issue (never a duplicate), and skips instead of failing if the site is unreachable. |
