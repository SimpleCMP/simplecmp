#!/usr/bin/env bash
# ADR-0013 Phase 0 baseline — render-time numbers WITHOUT the rewriter.
# Re-run after Phase 0 rewriter prototype lands and diff the columns.
set -euo pipefail

pages=(
  "/de/home"
  "/de/elemente"
  "/de/extensions/blog/ein-testblogpost"
  "/de/extensions/blog"
  "/de/test-worst-case"
)

# Warm caches once per page so we measure steady-state cached render.
for p in "${pages[@]}"; do
  curl -sk -o /dev/null "https://dev14.ddev.site$p"
done

printf '%-50s %10s %10s %10s %10s %10s\n' 'page' 'min(ms)' 'p50(ms)' 'p95(ms)' 'max(ms)' 'bytes'
for p in "${pages[@]}"; do
  times=()
  size=0
  for i in {1..20}; do
    out=$(curl -sk -o /dev/null -w '%{time_starttransfer} %{size_download}' "https://dev14.ddev.site$p")
    t=$(echo "$out" | awk '{print $1}')
    size=$(echo "$out" | awk '{print $2}')
    times+=("$t")
  done
  # ms conversions + percentiles via sort
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  min=$(echo "$sorted" | head -1 | awk '{printf "%.1f", $1*1000}')
  max=$(echo "$sorted" | tail -1 | awk '{printf "%.1f", $1*1000}')
  p50=$(echo "$sorted" | sed -n '10p' | awk '{printf "%.1f", $1*1000}')
  p95=$(echo "$sorted" | sed -n '19p' | awk '{printf "%.1f", $1*1000}')
  printf '%-50s %10s %10s %10s %10s %10s\n' "$p" "$min" "$p50" "$p95" "$max" "$size"
done
