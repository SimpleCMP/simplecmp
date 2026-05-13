# src/recorder/

The **record mode** detects cookies and external connections that need consent.

## Planned components

- **cookie-watcher**: polls `document.cookie` and diffs to detect newly set cookies
- **dom-watcher**: `MutationObserver` on `<script>`, `<iframe>`, `<img>`, and other tags
  that can cause network requests
- **network-watcher**: `PerformanceObserver` (`resource` entries) for outgoing connections
- **classifier**: matches detected cookies and domains against the Service DB

## When does it run?

Record mode is opt-in via `init({ record: true })`. It's intended for development and
staging environments. In production, the CMS bridge takes its place — only unknown
items are reported, not every observed cookie.

## Status

Phase 2 of the roadmap. Implementation begins after Phase 1 (core) is stable.
