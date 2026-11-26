#!/usr/bin/env bash
# Adaptador de fixture: deploy só grava um marcador em TMPDIR.
set -euo pipefail

: "${RELEASE_ENV:?RELEASE_ENV ausente}"
: "${RELEASE_VERSION:?RELEASE_VERSION ausente}"

printf 'fase: deploy\n'
printf 'RELEASE_ENV=%s\n' "$RELEASE_ENV"
printf 'RELEASE_VERSION=%s\n' "$RELEASE_VERSION"
printf 'RELEASE_DIGEST=%s\n' "${RELEASE_DIGEST:-}"
printf 'RELEASE_MANIFEST=%s\n' "${RELEASE_MANIFEST:-}"
printf 'RELEASE_ACTOR=%s\n' "${RELEASE_ACTOR:-}"
printf 'RELEASE_TARGET_REF=%s\n' "${RELEASE_TARGET_REF:-}"

marker="${TMPDIR:-/tmp}/${RELEASE_ENV}-${RELEASE_VERSION}.marker"
: > "$marker"
printf 'marcador: %s\n' "$marker"
printf 'deploy: ok (fixture)\n'
