# Fasti

Fasti is a web front end for [Remind](https://dianne.skoll.ca/projects/remind/),
Dianne Skoll's plain-text reminder language. It runs as a static site, works
offline on phones and desktops, and reads and writes your own `.rem` files
where you already keep them: GitHub, any git host, Dropbox, OneDrive or WebDAV.

Every date Fasti shows comes from Remind itself, compiled to WebAssembly and
run in your browser. Fasti only edits the lines you change, so your files keep
their comments, spacing and everything Fasti doesn't understand.

**Status:** under construction. See [docs/PLAN.md](docs/PLAN.md) for the plan
and its progress.

The name comes from the Roman *fasti*, calendars that marked which days were
open for business (*dies fasti*) and which were not (*nefasti*).

## Notices

- Fasti is **not affiliated with or endorsed by** Remind or Dianne Skoll.
- Remind is © Dianne Skoll and others, licensed under the GNU General Public
  License, version 2. Its source is in [engine/vendor/](engine/vendor/).
- Fasti was **built with AI assistance** (Claude, by Anthropic).
- Fasti is free software under the GNU General Public License, version 2 or
  later ([LICENSE](LICENSE)). The published site includes Remind and is
  conveyed under GPL-2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
engine/build.sh      # Remind to WebAssembly, in the pinned emsdk image
```
