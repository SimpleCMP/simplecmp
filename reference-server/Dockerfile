# SimpleCMP service-DB reference server — production image for
# library.simplecmp.eu (and reusable as a generic distroless host).
#
# Stack: FrankenPHP (Caddy + PHP-FPM in one binary) on Alpine, PHP 8.4.
# - HTTPS handled upstream by Coolify/Traefik; we listen plain HTTP :8080.
# - Persistent volume mounted at /data: SQLite + services-library clone.
# - Hourly rebuild via bin/rebuild-from-library.php (Coolify scheduled task).

# -----------------------------------------------------------------------------
# Stage 1: composer install (no dev deps)
# -----------------------------------------------------------------------------
FROM composer:2 AS vendor

WORKDIR /src
COPY composer.json composer.lock ./
RUN composer install \
        --no-dev \
        --no-interaction \
        --no-scripts \
        --prefer-dist \
        --optimize-autoloader

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM dunglas/frankenphp:1-php8.4-alpine

# git for the hourly services-library pull; tini gives us PID-1 signal handling.
RUN apk add --no-cache git tini ca-certificates \
 && install-php-extensions pdo_sqlite

WORKDIR /app

# Vendor dir from the build stage, then the rest of the project.
COPY --from=vendor /src/vendor ./vendor
COPY src ./src
COPY public ./public
COPY bin ./bin
COPY seeds ./seeds

# Persistent state lives at /data — SQLite + services-library checkout.
# Coolify mounts a volume here; in plain Docker, mount with -v.
ENV SIMPLECMP_DB_PATH=/data/service-db.sqlite \
    SIMPLECMP_LIBRARY_PATH=/data/services-library \
    SIMPLECMP_LIBRARY_REPO=https://github.com/SimpleCMP/services-library.git \
    SIMPLECMP_LIBRARY_BRANCH=main \
    SERVER_NAME=:8080

RUN mkdir -p /data \
 && chown -R www-data:www-data /data /app \
 && chmod +x /app/bin/*.php

COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
