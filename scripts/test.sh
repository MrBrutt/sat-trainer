#!/usr/bin/env bash
# Runs the browser tests (tests/index.html) in headless Chrome and prints the results.
# Needs a local server for the repo, e.g. python3 -m http.server 8765 from the folder above it.
# Usage: scripts/test.sh [URL]   (default http://localhost:8765/app/tests/)
set -euo pipefail

url=${1:-http://localhost:8765/app/tests/}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT

dom=$("$chrome" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" \
  --virtual-time-budget=30000 --dump-dom "$url" 2>/dev/null)
out=$(printf '%s' "$dom" | python3 -I -c '
import sys, html, re
m = re.search(r"<pre id=\"out\">(.*?)</pre>", sys.stdin.read(), re.S)
print(html.unescape(m.group(1)) if m else "no test output")')
printf '%s\n' "$out"
case "$(printf '%s\n' "$out" | tail -n 1)" in PASS*) exit 0 ;; *) exit 1 ;; esac
