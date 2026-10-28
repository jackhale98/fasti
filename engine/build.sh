#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Builds Remind to WebAssembly from the release tarball in engine/vendor/.
#
#   engine/build.sh            run the build inside the pinned emsdk Docker image
#   engine/build.sh --inside   run it here (already inside emsdk: CI, or the image)
#
# Output: static/engine/remind.mjs and remind.wasm (not committed; a CI
# artifact) and engine/BUILD-INFO.json (committed, so a change to the engine
# shows up in review).
#
# Ground rules (docs/PLAN.md section 2): Remind is built only from the tarball
# the human committed. This script never downloads Remind and never contacts
# its author's sites. Any change to Remind's C lives in engine/patches/, one
# patch per change, each with a comment saying why.
set -euo pipefail

# emscripten/emsdk 6.0.13, pinned by digest so the build is reproducible.
EMSDK_IMAGE="emscripten/emsdk:6.0.13@sha256:fb7864e398acfda863dfcea78b8bc8adad359fa60c6a0bbeb845931de64aa68a"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ "${1:-}" != "--inside" ]]; then
	exec docker run --rm \
		--user "$(id -u):$(id -g)" \
		-e SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}" \
		-v "$root:/src" -w /src \
		"$EMSDK_IMAGE" engine/build.sh --inside
fi

shopt -s nullglob
tarballs=(engine/vendor/remind-*.tar.gz)
if [[ ${#tarballs[@]} -ne 1 ]]; then
	echo "engine/build.sh: expected exactly one engine/vendor/remind-*.tar.gz, found ${#tarballs[@]}." >&2
	echo "The human downloads the release by hand (docs/PLAN.md section 12, step 1)." >&2
	exit 1
fi
tarball="${tarballs[0]}"
version="$(basename "$tarball" .tar.gz)"
version="${version#remind-}"

# The tarball must match the SHA-256 the human recorded in SOURCE.md: the first
# 64-hex string on a line starting "SHA-256" or "- SHA-256" (any case, any
# words in between, e.g. "- SHA-256 (verified): <hex>").
expected="$(grep -iE '^[[:space:]]*(-[[:space:]]*)?sha-?256' engine/vendor/SOURCE.md | grep -oiE '\b[0-9a-f]{64}\b' | head -1 || true)"
actual="$(sha256sum "$tarball" | cut -d' ' -f1)"
if [[ -z "$expected" || "${expected,,}" != "$actual" ]]; then
	echo "engine/build.sh: $tarball has SHA-256 $actual, but engine/vendor/SOURCE.md records '${expected:-nothing}'." >&2
	exit 1
fi

work="engine/.build"
rm -rf "$work"
mkdir -p "$work" static/engine
# Configure runs its test programs with node. They are extensionless, so node
# would take the repo's package.json ("type": "module") and load them as ES
# modules, which fails; mark the scratch tree as CommonJS.
echo '{ "type": "commonjs" }' > "$work/package.json"
tar -xzf "$tarball" -C "$work"
src="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"

patches=()
for patch in engine/patches/*.patch; do
	patch -d "$src" -p1 --forward --batch < "$patch"
	patches+=("$(basename "$patch")")
done

# Compile and link flags (docs/PLAN.md section 3.2, docs/engine.md). No
# pthreads: GitHub Pages can't send the COOP/COEP headers shared memory needs.
# `node` is in ENVIRONMENT only so the golden tests can run the same module
# under Vitest. ENV is exported so a run can set TZ, LANG and so on.
COMPILE_FLAGS="-O2"
LINK_FLAGS=(
	-O2
	-sMODULARIZE
	-sEXPORT_ES6
	-sEXPORT_NAME=createRemind
	-sENVIRONMENT=worker,node
	-sINVOKE_RUN=0
	-sEXIT_RUNTIME=1
	-sALLOW_MEMORY_GROWTH
	-sFORCE_FILESYSTEM
	-sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV
)
# Emscripten library overrides, used instead of patches to Remind's C. Listed
# by repo path (as recorded in BUILD-INFO.json); linked by absolute path.
JS_LIBRARIES=(engine/time-zone.js.in)
js_library_flags=()
for lib in "${JS_LIBRARIES[@]}"; do
	js_library_flags+=("--js-library=$root/$lib")
done

(
	cd "$src"
	# CFLAGS replaces autoconf's default "-g -O2": DWARF made the wasm 4x bigger
	# and limit wasm-opt. Configure adds Remind's own warnings and -flto=auto.
	emconfigure ./configure CFLAGS="$COMPILE_FLAGS"
	# Configure's test programs are linked plainly; the module flags go to the
	# final link only, where they shape src/remind (JS) and remind.wasm.
	# src/Makefile bakes @LDFLAGS@ in at configure time, so LDFLAGS on the make
	# command line is ignored; LDEXTRA is its hook on the remind link line.
	emmake make -C src remind LDEXTRA="${LINK_FLAGS[*]} ${js_library_flags[*]}"
)

cp "$src/src/remind" static/engine/remind.mjs
cp "$src/src/remind.wasm" static/engine/remind.wasm

emcc_version="$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
json_list() { printf '%s\n' "$@" | sed '/^$/d; s/.*/"&"/' | paste -sd, - | sed 's/,/, /g'; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
cat > engine/BUILD-INFO.json <<JSON
{
	"remind": "$version",
	"tarball": "$(basename "$tarball")",
	"tarballSha256": "$actual",
	"emsdk": "$emcc_version",
	"emsdkImage": "$EMSDK_IMAGE",
	"compileFlags": "$COMPILE_FLAGS",
	"linkFlags": "${LINK_FLAGS[*]}",
	"jsLibraries": [$(json_list "${JS_LIBRARIES[@]}")],
	"jsLibrariesSha256": [$(json_list "$(for lib in "${JS_LIBRARIES[@]}"; do sha "$lib"; done)")],
	"patches": [$(json_list "${patches[@]+"${patches[@]}"}")],
	"remindWasmSha256": "$(sha static/engine/remind.wasm)",
	"remindMjsSha256": "$(sha static/engine/remind.mjs)"
}
JSON

# gzip -n: no name or timestamp in the header, so sizes are reproducible too.
wasm_gz=$(gzip -9cn static/engine/remind.wasm | wc -c)
glue_gz=$(gzip -9cn static/engine/remind.mjs | wc -c)
echo "Built Remind $version: remind.wasm ${wasm_gz} B + remind.mjs ${glue_gz} B gzipped = $((wasm_gz + glue_gz)) B (budget 409600 B)."
