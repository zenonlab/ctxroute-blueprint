#!/bin/bash

orbite_stop_agent_children() {
  local agent_state="$1"
  local agent_pid child_pid child_command
  local -a child_pids=()
  agent_pid="$(printf '%s\n' "$agent_state" | sed -n 's/^[[:space:]]*pid = //p')"
  [[ "$agent_pid" =~ ^[0-9]+$ ]] || return 0
  while IFS= read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    child_command="$(ps -p "$child_pid" -o command= 2>/dev/null || true)"
    [[ -n "$child_command" ]] || continue
    kill -TERM "$child_pid"
    child_pids+=("$child_pid")
  done < <(pgrep -P "$agent_pid" 2>/dev/null || true)
  for child_pid in "${child_pids[@]}"; do
    for _ in {1..50}; do
      kill -0 "$child_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -0 "$child_pid" 2>/dev/null && {
      echo "Owned RenderHost did not stop cleanly (pid $child_pid)." >&2
      return 1
    }
  done
  return 0
}
