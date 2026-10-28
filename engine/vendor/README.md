# engine/vendor

Remind's official release tarball goes here, committed by a human
(docs/PLAN.md section 12, step 1). Fasti's tools never download Remind or
contact its author's sites.

1. From the Remind project page, download the latest release tarball
   (`remind-<version>.tar.gz`) and its signature (`remind-<version>.tar.gz.asc`).
2. Verify the signature with the author's public key (`gpg --verify`).
3. Put both files in this directory and write `SOURCE.md` next to them:

   ```markdown
   # Remind source

   - Release: 06.03.06
   - Downloaded from: <the URL you used>
   - Downloaded on: 2026-10-28
   - Signature: verified with gpg (key fingerprint <fingerprint>)
   - SHA-256: <output of `sha256sum remind-06.03.06.tar.gz`>
   ```

   `engine/build.sh` refuses to build if the tarball's SHA-256 doesn't match
   the `SHA-256:` line.
4. Commit the three files.

The tarball is also the corresponding source for the `remind.wasm` that Fasti
ships (GPL-2.0, section 3), together with `engine/build.sh` and
`engine/patches/`.
