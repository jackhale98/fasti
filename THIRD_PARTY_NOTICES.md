# Third-party notices

Fasti is free software under the GNU General Public License, version 2 or
(at your option) any later version (`LICENSE`). The site Fasti publishes
includes the software below. Because it includes Remind (GPL-2.0-only), the
published site as a whole is conveyed under GPL-2.0.

## Remind

Remind, the reminder program that computes every date Fasti shows, is
copyright Dianne Skoll and others and is licensed under the GNU General Public
License, version 2. Fasti runs an unmodified build of it, compiled to
WebAssembly (`remind.wasm`), as a separate program in its own worker.

- Corresponding source: the release tarball in `engine/vendor/`, built by
  `engine/build.sh` with the patches in `engine/patches/` (if any).
- Its full copyright notice is copied here from the tarball when the tarball
  is committed (docs/PLAN.md section 12, step 1). Until then the site does not
  include Remind.

Fasti is not affiliated with or endorsed by Remind or its author.

## Code adapted from Mycelium

Nothing has been copied from Mycelium yet. Before any of its modules are
copied, their copyright holder records here the grant that lets Fasti use them
under GPL-2.0-or-later (docs/PLAN.md section 12, step 2).

## JavaScript packages in the site

Checked by `npm run licenses` on every CI run, which fails on any licence not
compatible with GPLv2.

| Package | Licence | Copyright |
| --- | --- | --- |
| svelte | MIT | Copyright (c) 2016-2025 Svelte Contributors |
| @sveltejs/kit | MIT | Copyright (c) 2020 the SvelteKit contributors |
| devalue | MIT | Copyright (c) 2018-19 the devalue contributors |

The MIT licence text is in each package's `LICENSE` file.

## Fonts

All under the SIL Open Font License 1.1, served from the site through the
Fontsource packages.

| Font | Copyright |
| --- | --- |
| Young Serif | Copyright 2023 The Young Serif Project Authors (https://github.com/noirblancrouge/YoungSerif) |
| Hanken Grotesk | Copyright 2021 The Hanken Grotesk Project Authors (https://github.com/marcologous/hanken-grotesk) |
| IBM Plex Mono | Copyright 2017 IBM Corp. All rights reserved. |
