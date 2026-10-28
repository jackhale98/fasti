# Cloud storage

**Not built yet.** Sync with Dropbox, OneDrive and WebDAV comes in Phase 4 of
the [plan](PLAN.md). Until then nothing on this page is needed, and Fasti
shows no sign-in buttons. This page will get step-by-step instructions when
sync is built and tested; the list below is what the site's owner will need
then, taken from the plan (sections 3.5, 3.7 and 12).

## How it will work

- **Dropbox** and **OneDrive / SharePoint**: you sign in from the browser
  (OAuth with PKCE, so no secret is involved) and Fasti talks to the service
  directly. Changes are saved back a few seconds after each edit.
- **WebDAV** (Nextcloud and others): Fasti goes through its worker's WebDAV
  relay, which handles the browser's cross-origin rules. Changes are saved
  back the same way.
- Conflicts are merged three ways, and anything that can't be merged is shown
  side by side for you to choose. Nothing is overwritten silently.

## What the owner will need

1. **A Dropbox app**, with Fasti's address as a redirect URI. Its app key goes
   in the repo variable `PUBLIC_DROPBOX_APP_KEY`.
2. **A Microsoft Entra app registration** for OneDrive, with Fasti's address
   as a redirect URI. Its application (client) id goes in the
   repo variable `PUBLIC_ONEDRIVE_CLIENT_ID`.
3. **For WebDAV, Fasti's worker**, deployed, with `PUBLIC_WORKER_URL` set (see
   [setup-worker.md](setup-worker.md)). The worker's `DAV_HOSTS` can limit
   which servers the relay serves.
4. Set the repo variables (GitHub: Settings, Secrets and variables, Actions,
   Variables), then re-run the deploy.

A sign-in button appears only for a provider whose variables are set. The
exact redirect paths and permissions will be written here when sync is built.
