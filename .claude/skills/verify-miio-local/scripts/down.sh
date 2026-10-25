#!/usr/bin/env bash
# Stops the instance of one run and removes its Homebridge storage. Keeps the evidence:
# homebridge.log, transcript.log, rig.out and anything saved under the run dir.
# Usage: down.sh <run-id>
set -euo pipefail
run_id=${1:?usage: down.sh <run-id>}
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
run_dir="$repo/.local/verify/$run_id"
[[ -d "$run_dir" ]] || { echo "no run dir $run_dir" >&2; exit 1; }

if [[ -f "$run_dir/rig.json" ]]; then
  pid=$(jq -r .pid "$run_dir/rig.json")
  # Only a process that is this run's rig is killed.
  if ps -o command= -p "$pid" 2>/dev/null | grep -q 'verify-miio-local/scripts/rig.ts'; then
    kill -TERM "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && { echo "rig $pid did not stop" >&2; exit 1; }
  fi
  rm -f "$run_dir/rig.json"
fi
rm -rf "$run_dir/hb"
echo "down run=$run_id; evidence kept in $run_dir"
ls -1 "$run_dir"
