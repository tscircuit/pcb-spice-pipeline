#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node dist/cli.mjs --help
if ! command -v ngspice >/dev/null; then
  if command -v apt-get >/dev/null; then sudo apt-get update && sudo apt-get install -y ngspice; fi
fi
node --import tsx --test --test-name-pattern='native three-signal' tests/general.integration.mjs
