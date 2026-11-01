#!/bin/sh
set -eu
SIKAGIT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SIKAGIT_UID=$(id -u)
SIKAGIT_GID=$(id -g)
docker build -f "$SIKAGIT_ROOT/Dockerfile.reviewed" -t local/sikagit:security-test "$SIKAGIT_ROOT"
docker run --rm --network none --read-only --user "$SIKAGIT_UID:$SIKAGIT_GID" \
  --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 160 \
  --tmpfs "/tmp:rw,nosuid,nodev,size=128m,uid=$SIKAGIT_UID,gid=$SIKAGIT_GID" \
  -v "$SIKAGIT_ROOT/tests:/tests:ro" --entrypoint node \
  local/sikagit:security-test --test /tests/security.test.cjs
