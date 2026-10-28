#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# The checks CI runs (but e2e), stopping at the first failure. Exit codes are
# never hidden behind a pipe.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run format:check
npm run lint
npm run spdx
npm run check
npm test
npm run build
npm run licenses
echo "verify: all checks passed"
