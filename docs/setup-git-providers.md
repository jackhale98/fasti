# Git providers

**Not built yet.** Sync with GitHub and other git hosts comes in Phase 4 of
the [plan](PLAN.md). Until then nothing on this page is needed, and Fasti
shows no sign-in buttons. This page will get step-by-step instructions when
sync is built and tested; the list below is what the site's owner will need
then, taken from the plan (sections 3.5, 3.7 and 12).

## How it will work

- **GitHub**: sign in through a GitHub App, with the code exchanged by Fasti's
  worker. Fasti then pulls, commits and pushes through the worker's git proxy.
- **Any git host**: an HTTPS clone URL plus an access token. GitLab and
  Bitbucket also get sign-in buttons when their OAuth apps are configured.
- Edits change a working copy. The Sync view lists changed files with diffs,
  and you commit, pull and push yourself; Fasti never commits on its own.
  Conflicts are merged three ways, and anything that can't be merged is shown
  side by side for you to choose. Nothing is overwritten silently.

## What the owner will need

1. **Fasti's worker**, deployed, with `PUBLIC_WORKER_URL` set. See
   [setup-worker.md](setup-worker.md).
2. **A GitHub App** for sign-in, with Fasti's address as its callback URL.
   Its client id and secret go on the worker as the secrets
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
3. **Optionally, a GitLab and a Bitbucket OAuth app**, each with Fasti's
   address as the redirect URL, and their secrets on the worker (`GITLAB_*`,
   `BITBUCKET_*`; GitLab needs only the id if its app is public).
4. **Repo variables** (GitHub: Settings, Secrets and variables, Actions,
   Variables), then re-run the deploy:
   - `PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_GITHUB_APP_SLUG`
   - `PUBLIC_GITLAB_CLIENT_ID` (optional)
   - `PUBLIC_BITBUCKET_CLIENT_ID` (optional)
5. For a self-hosted git server, its host name in the worker's
   `EXTRA_GIT_HOSTS`.

A sign-in button appears only for a provider whose variables are set. The
exact redirect paths, app permissions and scopes will be written here when
sync is built.
