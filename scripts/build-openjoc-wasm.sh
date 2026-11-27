#!/usr/bin/env bash
set -euo pipefail

readonly OPENJOC_COMMIT="f9b54bbbb8e1b44c746a72e1b14b289cad418cf9"
readonly OPENJOC_REPOSITORY="https://github.com/chyinan/OpenJOC.git"
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly WORK_DIR="${TMPDIR:-/tmp}/libretv-openjoc-${OPENJOC_COMMIT}"
readonly OUTPUT_DIR="${ROOT}/public/wasm"

if ! command -v cargo >/dev/null || ! command -v rustup >/dev/null; then
  echo "Rust and Cargo are required to build the pinned OpenJOC WASM runtime." >&2
  exit 1
fi

if [[ ! -d "${WORK_DIR}/.git" ]]; then
  rm -rf "${WORK_DIR}"
  git clone --filter=blob:none --no-checkout "${OPENJOC_REPOSITORY}" "${WORK_DIR}"
fi
git -C "${WORK_DIR}" fetch --depth=1 origin "${OPENJOC_COMMIT}"
git -C "${WORK_DIR}" checkout --detach "${OPENJOC_COMMIT}"
test "$(git -C "${WORK_DIR}" rev-parse HEAD)" = "${OPENJOC_COMMIT}"

rustup target add wasm32-unknown-unknown
cargo build --manifest-path "${WORK_DIR}/Cargo.toml" --locked --release \
  --target wasm32-unknown-unknown -p openjoc-wasm

mkdir -p "${OUTPUT_DIR}"
install -m 0644 "${WORK_DIR}/target/wasm32-unknown-unknown/release/openjoc_wasm.wasm" \
  "${OUTPUT_DIR}/openjoc_wasm.wasm"
install -m 0644 "${WORK_DIR}/LICENSE" "${OUTPUT_DIR}/OPENJOC-LICENSE"
cargo tree --manifest-path "${WORK_DIR}/Cargo.toml" --locked -p openjoc-wasm \
  --target wasm32-unknown-unknown > "${OUTPUT_DIR}/openjoc-dependency-tree.txt"
printf '{"project":"OpenJOC","version":"0.20.2","commit":"%s","target":"wasm32-unknown-unknown","features":["embedded-builtin-hrtf"]}\n' \
  "${OPENJOC_COMMIT}" > "${OUTPUT_DIR}/openjoc-build-manifest.json"
sha256sum "${OUTPUT_DIR}/openjoc_wasm.wasm" | tee "${OUTPUT_DIR}/openjoc_wasm.wasm.sha256"
