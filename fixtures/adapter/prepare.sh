#!/usr/bin/env bash
# Adaptador de fixture: prepare sem efeito externo.
set -euo pipefail

: "${RELEASE_ENV:?RELEASE_ENV ausente}"
: "${RELEASE_VERSION:?RELEASE_VERSION ausente}"

printf 'fase: prepare\n'
printf 'RELEASE_ENV=%s\n' "$RELEASE_ENV"
printf 'RELEASE_VERSION=%s\n' "$RELEASE_VERSION"
printf 'RELEASE_DIGEST=%s\n' "${RELEASE_DIGEST:-}"
printf 'RELEASE_MANIFEST=%s\n' "${RELEASE_MANIFEST:-}"
printf 'RELEASE_ACTOR=%s\n' "${RELEASE_ACTOR:-}"
printf 'RELEASE_TARGET_REF=%s\n' "${RELEASE_TARGET_REF:-}"
printf 'aviso: prepare.sh é fixture; nenhum efeito real\n'
