#!/usr/bin/env bash
# Idempotent bootstrap for the bundled youtube-cleanup CLI.
# Prints "READY <path>" on success; exits non-zero with a diagnosis otherwise.
set -euo pipefail

here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# scripts -> youtube-history-cleanup -> skills -> <plugin root>
plugin_root="${CLAUDE_PLUGIN_ROOT:-$(cd -P "$here/../../.." && pwd -P)}"
cli_dir="$plugin_root/cli"

if [ ! -f "$cli_dir/package.json" ]; then
  echo "ERROR: no CLI found at $cli_dir" >&2
  echo "  The plugin appears incomplete — cli/package.json is missing." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not on PATH. Node.js 20+ is required." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required, found $(node -v)." >&2
  exit 1
fi

if [ ! -d "$cli_dir/node_modules" ]; then
  echo "Installing CLI dependencies (one time)..." >&2
  npm --prefix "$cli_dir" install --omit=dev --silent >&2
fi

# The build also needs devDependencies (typescript). Install them only if the
# compiled output is missing, so a normal run stays lean.
if [ ! -f "$cli_dir/dist/cli.js" ]; then
  echo "Building the CLI (one time)..." >&2
  npm --prefix "$cli_dir" install --silent >&2
  npm --prefix "$cli_dir" run build --silent >&2
fi

if [ ! -f "$cli_dir/dist/cli.js" ]; then
  echo "ERROR: build produced no dist/cli.js in $cli_dir" >&2
  exit 1
fi

echo "READY $cli_dir/dist/cli.js"
