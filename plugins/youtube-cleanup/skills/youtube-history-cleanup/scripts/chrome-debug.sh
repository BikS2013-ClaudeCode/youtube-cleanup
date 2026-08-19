#!/usr/bin/env bash
# Starts a Chrome instance with the DevTools port open, on a dedicated profile.
#
# A separate --user-data-dir is REQUIRED: since Chrome 136 the debugging port is
# refused on the default profile directory, as anti-cookie-theft hardening. With
# the default profile the port silently never opens.
#
#   --copy-session   copy the signed-in session from the normal profile
#                    (requires Chrome to be fully quit)
#   --stop           shut the debug instance down
set -euo pipefail

port="${YOUTUBE_CLEANUP_DEBUG_PORT:-9222}"
profile="$HOME/.chrome-debug-profile"
real_profile="$HOME/Library/Application Support/Google/Chrome"
copy_session=0

for arg in "$@"; do
  case "$arg" in
    --copy-session) copy_session=1 ;;
    --stop)
      pkill -f "user-data-dir=$profile" 2>/dev/null && echo "debug Chrome stopped" || echo "debug Chrome was not running"
      exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$copy_session" = "1" ]; then
  if pgrep -f "Contents/MacOS/Google Chrome" >/dev/null 2>&1; then
    echo "ERROR: Chrome is still running. Quit it completely (Cmd+Q) first —" >&2
    echo "  it locks the cookie database and the copy would be incomplete." >&2
    exit 1
  fi
  mkdir -p "$profile/Default"
  cp -f "$real_profile/Local State" "$profile/Local State"
  cp -f "$real_profile/Default/Cookies" "$profile/Default/Cookies"
  echo "Copied session state into $profile"
  echo "NOTE: that is a working duplicate of your Google session. Delete"
  echo "      $profile when you no longer need it."
fi

if curl -s -m 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
  echo "already listening on port $port"
  exit 0
fi

# `open -na` detaches via LaunchServices, so the instance survives the shell
# that started it. A backgrounded direct binary invocation does not.
open -na "Google Chrome" --args \
  --remote-debugging-port="$port" \
  --user-data-dir="$profile" \
  --no-first-run --no-default-browser-check \
  "https://www.youtube.com/feed/history"

for _ in $(seq 1 25); do
  if curl -s -m 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
    echo "debug Chrome listening on port $port"
    echo "If it shows you signed out, either sign in to Google in that window,"
    echo "or quit Chrome entirely and re-run this script with --copy-session."
    exit 0
  fi
  sleep 1
done

echo "ERROR: port $port did not open within 25s." >&2
exit 1
