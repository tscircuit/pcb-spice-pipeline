#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"
bundled_dir="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null && [ -x "$bundled_dir/node/bin/node" ]; then
  export PATH="$bundled_dir/node/bin:$bundled_dir/bin/fallback:$PATH"
fi
export PATH="/opt/homebrew/bin:$PATH"
command -v node >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or newer is required")'
if ! command -v pnpm >/dev/null; then npm install --global pnpm@11.25.0; fi
python_cmd="${PCB_SPICE_BOOTSTRAP_PYTHON:-python3}"
if command -v python3.11 >/dev/null; then python_cmd="${PCB_SPICE_BOOTSTRAP_PYTHON:-python3.11}"; fi
pnpm install --frozen-lockfile
"$python_cmd" scripts/setup-tools.py --install-deps
if [ ! -x .venv/bin/python3 ]; then "$python_cmd" -m venv .venv; fi
.venv/bin/python3 -m pip install -r requirements.lock.txt
pnpm typecheck
pnpm test
pnpm test:native
pnpm prove "$@"
