# Fasti

Fasti is a web front end for [Remind](https://dianne.skoll.ca/projects/remind/),
Dianne Skoll's plain-text reminder language. It runs in your browser, on a
phone or a desktop, and works offline once it has loaded.

**Try it:** <https://jackhale98.github.io/fasti/>

The name comes from the Roman *fasti*, calendars that marked which days were
open for business (*dies fasti*) and which were not (*nefasti*).

## What works today

- **Today**: overdue tasks, today's reminders in time order, heads-up warnings
  and the next two weeks.
- **Month**: a six-week grid with days off and holidays marked, and the
  reminders for the day you pick.
- **Script**: an editor for your `.rem` files with syntax colours, Remind's own
  error messages and a line inspector that explains each line and shows its
  next dates.
- **Quick add**: type a reminder in plain words ("dentist tomorrow at 3pm") and
  Fasti writes the `REM` line for you.
- **Inspector**: tap any reminder to see what it means, its next dates, mark a
  task done, edit or delete the line, with undo.
- **Settings**: import your own `.rem` files or a folder, choose the main file,
  export everything as a zip, week start, 12- or 24-hour times, theme,
  notifications and calendar export (`.ics`).
- **Notifications** for reminders with an `AT` time, while Fasti is open, and
  while it is closed if push is set up for the copy you use.
- **Install as an app** on phones and desktops; it then works offline.

The [user guide](docs/user-guide.md) explains each of these.

## Not built yet

Sync is not built yet. Fasti will read and write your files in GitHub, other
git hosts (GitLab, Bitbucket, any HTTPS git server), Dropbox, OneDrive and
WebDAV (Nextcloud and others), but that is Phase 4 of the
[plan](docs/PLAN.md) and has not started. Until then your files live only in
the browser you use Fasti in. Import them from Settings, and use **Export as
zip** for a backup. The Sync tab is a placeholder for now.

## How it works

- **Remind computes every date.** Fasti runs the real Remind program, compiled
  to WebAssembly, inside your browser. Fasti's own code never works out a date;
  it only shows what Remind prints. Remind always runs with `-r`, so nothing in
  a script is ever executed (`RUN`, `shell()` and `INCLUDECMD` are off).
- **Byte-exact edits.** When you change a reminder, Fasti changes only the
  characters on that line. Comments, spacing, line endings, continuation lines
  and anything Fasti doesn't understand stay exactly as they were. Fasti never
  rewrites a whole file.
- **Your files stay in your browser.** They are kept in the browser's own
  storage (IndexedDB) on your device. Nothing is uploaded. When sync exists,
  files will go only to the place you connect.
- **Works offline.** After the first visit the whole app, including Remind, is
  stored on your device and runs without a connection.

## Notices

- Fasti is **not affiliated with or endorsed by** Remind or Dianne Skoll.
- Remind is © Dianne Skoll and others, licensed under the GNU General Public
  License, version 2. Its source, as Fasti builds it, is in
  [engine/vendor/](engine/vendor/).
- Fasti was **built with AI assistance** (Claude, by Anthropic).
- Fasti is free software under the GNU General Public License, version 2 or
  later ([LICENSE](LICENSE)). The published site includes Remind, so the site
  as a whole is conveyed under GPL-2.0. See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Documentation

- [User guide](docs/user-guide.md)
- [Setting up the worker](docs/setup-worker.md) (for push notifications)
- [Git providers](docs/setup-git-providers.md) and
  [cloud storage](docs/setup-cloud-storage.md) (come with sync)
- [How Fasti runs Remind](docs/engine.md) and a
  [Remind reference](docs/remind-reference.md)
- [Build plan and progress](docs/PLAN.md)

## Development

Needs Node 22 and, to build the engine, Docker.

```sh
npm install
npm run dev          # local server
npm run check        # svelte-check and TypeScript
npm run lint
npm test             # unit tests (Vitest)
npm run test:e2e     # Playwright, phone and desktop, light and dark, with axe
npm run build        # static site in build/
npm run licenses     # after a build: licences of the packages in the site
npm run spdx         # every source file has an SPDX header
npm run lighthouse   # Lighthouse CI, mobile then desktop, on the built site
scripts/verify.sh    # the checks CI runs (all but e2e), stopping at the first failure
engine/build.sh      # Remind to WebAssembly, in the pinned emsdk image

cd worker && npm install && npm test   # the Cloudflare worker's tests
```
