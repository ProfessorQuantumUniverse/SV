#!/usr/bin/env sh
# Starts a static server, runs the layout and the Claude-tooling suites, shuts the server down.
set -e
cd "$(dirname "$0")/.."
PORT="${PORT:-8123}"

npx --yes http-server -p "$PORT" -s . >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# wait for the server to accept connections
i=0
while [ "$i" -lt 40 ]; do
    if curl -sf "http://localhost:$PORT/index.html" >/dev/null 2>&1; then break; fi
    i=$((i + 1))
    sleep 0.25
done

BASE_URL="http://localhost:$PORT" node tests/protocol.test.mjs
BASE_URL="http://localhost:$PORT" node tests/tools.test.mjs
