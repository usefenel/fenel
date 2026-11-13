#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Opt-in local UI work can avoid starting the API and its account registries.
# The repository-local marker also works with the bot's fixed startup command.
if [ "${FENEL_DEV_FRONTEND_ONLY:-0}" = 1 ] || [ -f "$DIR/.tmp-dev-frontend-only" ]; then
  printf '[dev] Frontend-only mode; API is not started.\n'
  export PORT=3100
  exec bun --env-file "$DIR/.env" --filter './distros/narthex/solid' dev
fi

API_PID=
FRONTEND_PID=
STATE_DIR=
STARTING=yes
SIGNAL_STATUS=

handle_signal() {
  if [ -z "$SIGNAL_STATUS" ]; then SIGNAL_STATUS=$1; fi
  # Record both background PIDs before a signal can enter cleanup; $! has no
  # ownership until its assignment immediately after the background launch.
  if [ "$STARTING" = no ]; then exit "$SIGNAL_STATUS"; fi
}

# Each group has a Bash anchor which stays alive after Bun exits. Its live job
# reserves the group ID until cleanup, including when Bun leaves descendants.
owns_group() {
  local wanted=$1
  local pid
  for pid in $(jobs -pr; jobs -ps); do
    if [ "$pid" = "$wanted" ]; then return 0; fi
  done
  return 1
}

cleanup() {
  local exit_status=$?
  local pid
  trap - EXIT
  trap '' INT TERM
  for pid in "$API_PID" "$FRONTEND_PID"; do
    if [ -n "$pid" ] && owns_group "$pid"; then
      kill -TERM -- "-$pid" 2>/dev/null || true
    fi
  done
  # One shared two-second grace period, rather than an unbounded wait or a
  # separate grace period per server. Anchors retain ownership throughout it.
  if owns_group "$API_PID" || owns_group "$FRONTEND_PID"; then sleep 2; fi
  for pid in "$API_PID" "$FRONTEND_PID"; do
    if [ -n "$pid" ] && owns_group "$pid"; then
      kill -KILL -- "-$pid" 2>/dev/null || true
    fi
  done
  for pid in "$API_PID" "$FRONTEND_PID"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
  case "$STATE_DIR" in
    "$DIR"/.tmp-dev-supervisor.*) rm -rf -- "$STATE_DIR" || true ;;
  esac
  exit "$exit_status"
}
trap cleanup EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

child_exited() {
  local name=$1
  local exit_status
  read -r exit_status < "$STATE_DIR/$name.status"
  printf '[dev] %s exited with status %s; stopping both servers.\n' "$name" "$exit_status" >&2
  # Even a successful child exit is unexpected for these long-running servers.
  if [ "$exit_status" -eq 0 ]; then exit_status=1; fi
  exit "$exit_status"
}

anchor_exited() {
  local name=$1
  local pid=$2
  local exit_status=0
  wait "$pid" || exit_status=$?
  # A reaped PID is no longer ours to signal during cleanup.
  if [ "$name" = API ]; then API_PID=; else FRONTEND_PID=; fi
  printf '[dev] %s group anchor exited with status %s; stopping both servers.\n' "$name" "$exit_status" >&2
  if [ "$exit_status" -eq 0 ]; then exit_status=1; fi
  exit "$exit_status"
}

server_group() {
  local name=$1
  shift
  local stopping=no
  local worker
  local exit_status=0
  trap - EXIT
  # A caught TERM leaves the anchor alive; an ignored TERM would be inherited
  # by Bun. Cleanup owns the final group KILL after descendants get their grace.
  trap 'stopping=yes' INT TERM
  set +m
  "$@" &
  worker=$!
  wait "$worker" || exit_status=$?
  # A signal can interrupt wait before the worker exits. During cleanup the
  # supervisor already has its status, so do not publish that interrupted wait.
  if [ "$stopping" = no ]; then
    if printf '%s\n' "$exit_status" > "$STATE_DIR/$name.status.tmp" &&
      mv "$STATE_DIR/$name.status.tmp" "$STATE_DIR/$name.status"; then
      :
    elif [ "$stopping" = no ]; then
      exit 1
    fi
  fi
  # TERM also interrupts the anchor's current sleep. With inherited errexit,
  # tolerate that status so the group ID remains reserved until final KILL.
  while true; do sleep 1 || true; done
}

STATE_DIR=$(mktemp -d "$DIR/.tmp-dev-supervisor.XXXXXX")
# Bash 3.2 job control creates a distinct group for each background anchor.
set -m

# Start API server (port 3001). The engine-body replay recorded for the distro
# also serves the API's registry builds when its source epoch still matches;
# a stale or absent artifact is refused by the host and the API computes as
# before. An explicit FENEL_ENGINE_BODY_REPLAY (even empty) wins.
DEV_REPLAY_ARTIFACT="$DIR/distros/narthex/solid/.engine-body-replay/seed.gz"
DEV_REPLAY_EXPORTED=
if [ -z "${FENEL_ENGINE_BODY_REPLAY+set}" ] && [ -f "$DEV_REPLAY_ARTIFACT" ]; then
  export FENEL_ENGINE_BODY_REPLAY="$DEV_REPLAY_ARTIFACT"
  DEV_REPLAY_EXPORTED=yes
fi
server_group API bun implementations/typescript/api/src/server.ts </dev/null &
API_PID=$!
# Only the API reads it; the frontend keeps its own replay wiring.
if [ -n "$DEV_REPLAY_EXPORTED" ]; then unset FENEL_ENGINE_BODY_REPLAY; fi

# Start Vite dev server (port 3100)
PORT=3100 server_group Frontend bun --filter './distros/narthex/solid' dev </dev/null &
FRONTEND_PID=$!
STARTING=no
if [ -n "$SIGNAL_STATUS" ]; then exit "$SIGNAL_STATUS"; fi

# Exit as soon as either child dies so the supervisor (launchd) respawns the
# whole pair. Without this, if the API crashes the script keeps waiting on
# the frontend, leaving :3001 unbound until the next manual restart.
# Polling avoids `wait -n` which is bash 4.3+ only — macOS /bin/bash is 3.2.
while true; do
  if [ -f "$STATE_DIR/API.status" ]; then child_exited API; fi
  if [ -f "$STATE_DIR/Frontend.status" ]; then child_exited Frontend; fi
  if ! owns_group "$API_PID"; then anchor_exited API "$API_PID"; fi
  if ! owns_group "$FRONTEND_PID"; then anchor_exited Frontend "$FRONTEND_PID"; fi
  sleep 1
done
