#!/usr/bin/env bash
# Seeds ~/.tool-agents/youtube-cleanup/.env with working values.
# Never overwrites a value that is already set — the tool has no fallback
# defaults by design, so this only fills genuine blanks.
set -euo pipefail

cfg_dir="$HOME/.tool-agents/youtube-cleanup"
env_file="$cfg_dir/.env"
mkdir -p "$cfg_dir" && chmod 700 "$cfg_dir"
mkdir -p "$cfg_dir/out"
touch "$env_file" && chmod 600 "$env_file"

set_if_blank() {
  local key="$1" value="$2" comment="$3"
  if grep -qE "^${key}=.+$" "$env_file" 2>/dev/null; then
    echo "  kept   ${key} (already set)"
    return
  fi
  # Drop any blank-valued line for this key, then append a populated one.
  if grep -qE "^${key}=" "$env_file" 2>/dev/null; then
    grep -vE "^${key}=" "$env_file" > "$env_file.tmp" && mv "$env_file.tmp" "$env_file"
    chmod 600 "$env_file"
  fi
  { echo ""; echo "# $comment"; echo "${key}=${value}"; } >> "$env_file"
  echo "  set    ${key}=${value}"
}

set_if_blank YOUTUBE_CLEANUP_CDP_URL "http://127.0.0.1:9222" \
  "Chrome DevTools Protocol endpoint of the debug Chrome instance."
set_if_blank YOUTUBE_CLEANUP_OUTPUT_DIR "$cfg_dir/out" \
  "Absolute directory for JSON/CSV run manifests."
set_if_blank YOUTUBE_CLEANUP_MAX_SCROLLS "40" \
  "Lazy-load scroll iterations per harvest."
set_if_blank YOUTUBE_CLEANUP_ACTION_DELAY_MS "700" \
  "Pause between consecutive removal actions, in milliseconds."
set_if_blank YOUTUBE_CLEANUP_MAX_PASSES "60" \
  "Maximum verify-by-reload passes in a clearing run."

echo "Config file: $env_file (mode 0600)"
