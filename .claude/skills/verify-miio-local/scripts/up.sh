#!/usr/bin/env bash
# Builds the plugin and starts one verification instance in the background.
# Usage: up.sh <run-id>. Prints READY and the instance's ports, or fails with the log tail.
set -euo pipefail
run_id=${1:?usage: up.sh <run-id>}
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
run_dir="$repo/.local/verify/$run_id"

if [[ -f "$run_dir/rig.json" ]] && kill -0 "$(jq -r .pid "$run_dir/rig.json")" 2>/dev/null; then
  echo "run $run_id is already up; use another run id or down.sh $run_id" >&2
  exit 1
fi
mkdir -p "$run_dir"
(cd "$repo" && npm run build --silent)

VERIFY_RUN_DIR="$run_dir" nohup "$repo/node_modules/.bin/vite-node" \
  "$repo/.claude/skills/verify-miio-local/scripts/rig.ts" >"$run_dir/rig.out" 2>&1 &
rig_pid=$!

for _ in $(seq 1 90); do
  if grep -q '^READY' "$run_dir/rig.out" 2>/dev/null; then
    cat "$run_dir/rig.json"
    echo "READY run=$run_id dir=$run_dir"
    exit 0
  fi
  if grep -q '^NOT READY' "$run_dir/rig.out" 2>/dev/null || ! kill -0 "$rig_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
echo "rig did not become ready" >&2
tail -n 40 "$run_dir/rig.out" "$run_dir/homebridge.log" >&2 || true
kill "$rig_pid" 2>/dev/null || true
exit 1
