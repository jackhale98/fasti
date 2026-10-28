# Third-party notices

Fasti is free software under the GNU General Public License, version 2 or
(at your option) any later version (`LICENSE`). The site Fasti publishes
includes the software below. Because it includes Remind (GPL-2.0-only), the
published site as a whole is conveyed under GPL-2.0.

## Remind

Remind, the reminder program that computes every date Fasti shows, runs in
the site as `remind.wasm`: an unmodified build of Remind 06.03.06, compiled to
WebAssembly and run as a separate program in its own worker.

> REMIND is Copyright (C) 1992-2026 Dianne Skoll, except where noted in
> individual files.
>
> REMIND may be used and distributed according to the terms of the GNU General
> Public License, Version 2.

(From `COPYRIGHT` in the release tarball, which carries the full licence text.)

- Corresponding source: `engine/vendor/remind-06.03.06.tar.gz`, built by
  `engine/build.sh` with the patches in `engine/patches/` (if any).
- Fasti is not affiliated with or endorsed by Remind or its author.

Parts of Remind that `remind.wasm` includes under their own terms:

- `src/json.c`, `src/json.h`: Copyright (C) 2012-2021 the json-parser authors.
  All rights reserved. https://github.com/json-parser/json-parser

  > Redistribution and use in source and binary forms, with or without
  > modification, are permitted provided that the following conditions are met:
  >
  > 1. Redistributions of source code must retain the above copyright notice,
  >    this list of conditions and the following disclaimer.
  > 2. Redistributions in binary form must reproduce the above copyright
  >    notice, this list of conditions and the following disclaimer in the
  >    documentation and/or other materials provided with the distribution.
  >
  > THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS \`\`AS IS'' AND ANY
  > EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  > WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  > DISCLAIMED. IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE FOR ANY
  > DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  > (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  > LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  > ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  > (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  > THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

- `src/moon.c` (moonrise and moonset), derived from
  https://github.com/signetica/MoonRise: Copyright 2007 Stephen R. Schmitt;
  subsequent work Copyright 2020 Cyrus Rahman. "You may use or modify this
  source code in any way you find useful, provided that you agree that the
  author(s) have no warranty, obligations or liability."
- `src/md5.c`: written by Colin Plumb in 1993; public domain.

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
