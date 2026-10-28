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

# The tarball must match the SHA-256 the human recorded in SOURCE.md.
expected="$(grep -oiE 'sha-?256[^0-9a-f]*[0-9a-f]{64}' engine/vendor/SOURCE.md | grep -oiE '[0-9a-f]{64}' | head -1 || true)"
actual="$(sha256sum "$tarball" | cut -d' ' -f1)"
if [[ -z "$expected" || "${expected,,}" != "$actual" ]]; then
	echo "engine/build.sh: $tarball has SHA-256 $actual, but engine/vendor/SOURCE.md records '${expected:-nothing}'." >&2
	exit 1
fi

work="engine/.build"
rm -rf "$work"
mkdir -p "$work" static/engine
tar -xzf "$tarball" -C "$work"
src="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"

patches=()
for patch in engine/patches/*.patch; do
	patch -d "$src" -p1 --forward --batch < "$patch"
	patches+=("$(basename "$patch")")
done

# Link flags (docs/PLAN.md section 3.2). No pthreads: GitHub Pages can't send
# the COOP/COEP headers shared memory needs. `node` is in ENVIRONMENT only so
# the golden tests can run the same module under Vitest.
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
	-sEXPORTED_RUNTIME_METHODS=callMain,FS
)

(
	cd "$src"
	# Configure's test programs are linked plainly; the module flags are given
	# to the final link only, where they shape src/remind (JS) and remind.wasm.
	emconfigure ./configure
	emmake make -C src remind LDFLAGS="${LINK_FLAGS[*]}"
)

cp "$src/src/remind" static/engine/remind.mjs
cp "$src/src/remind.wasm" static/engine/remind.wasm

emcc_version="$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
patch_json="$(printf '%s\n' "${patches[@]+"${patches[@]}"}" | sed '/^$/d; s/.*/"&"/' | paste -sd, -)"
cat > engine/BUILD-INFO.json <<JSON
{
	"remind": "$version",
	"tarball": "$(basename "$tarball")",
	"tarballSha256": "$actual",
	"emsdk": "$emcc_version",
	"emsdkImage": "$EMSDK_IMAGE",
	"linkFlags": "$(printf '%s ' "${LINK_FLAGS[@]}" | sed 's/ $//')",
	"patches": [${patch_json}]
}
JSON

wasm_gz=$(gzip -9c static/engine/remind.wasm | wc -c)
glue_gz=$(gzip -9c static/engine/remind.mjs | wc -c)
echo "Built Remind $version: remind.wasm ${wasm_gz} B gzipped, remind.mjs ${glue_gz} B gzipped (budget 400 KB together)."
