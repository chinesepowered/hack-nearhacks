#!/usr/bin/env bash
# Builds the three contracts with cargo-near and copies the wasm into contracts/res/.
# The committed res/*.wasm are what `pnpm setup` deploys, so judges do not need Rust.
set -euo pipefail
cd "$(dirname "$0")"
for c in stall tusdc bazaar; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi)
  cp "target/near/$c/$c.wasm" "res/$c.wasm"
done
sha256sum res/*.wasm
