#!/bin/sh
# Container entrypoint: best-effort initial sync, then hand off to FrankenPHP.
#
# - If /data is fresh (no SQLite) try to rebuild from the upstream library.
# - If that fails (network down, repo unavailable) fall back to the local
#   seeds bundled in the image so the server can boot in a known state.
# - Always log the posture on stdout once at boot for audit trails.
set -e

: "${SIMPLECMP_DB_PATH:=/data/service-db.sqlite}"
: "${SIMPLECMP_LIBRARY_PATH:=/data/services-library}"

mkdir -p "$(dirname "$SIMPLECMP_DB_PATH")"

if [ ! -f "$SIMPLECMP_DB_PATH" ]; then
    echo "[entrypoint] no SQLite at $SIMPLECMP_DB_PATH — attempting initial sync"
    if php /app/bin/rebuild-from-library.php; then
        echo "[entrypoint] initial sync from upstream library succeeded"
    else
        echo "[entrypoint] upstream sync failed — falling back to bundled seeds"
        php /app/bin/seed.php --source=/app/seeds/services --db="$SIMPLECMP_DB_PATH" || true
    fi
fi

echo "[simplecmp-library] starting; access_log=off; sync_source=${SIMPLECMP_LIBRARY_REPO:-bundled-seeds}; db=$SIMPLECMP_DB_PATH"

exec "$@"
