# 0004. Recorder architecture

- **Status:** accepted
- **Date:** 2026-05-02
- **Deciders:** Sven Wappler

## Context

REQ-7 introduces SimpleCMP's recorder — a development-time mode that detects
cookies and external connections so developers don't have to manually catalog
every tracker. It's the headline differentiator vs. plain Klaro,
vanilla-cookieconsent and the commercial CMPs, and it's also the foundation
the later phases build on (REQ-8 Service DB, REQ-9 CMS Bridge).

Before writing code we need to settle the architecture, because several
choices ripple through the rest of the design and reversing them later will
be expensive:

- **When does the recorder run?** Only on opt-in? Only in dev?
- **How does it integrate with Klaro?** Inside the consent flow or alongside?
- **What watchers do we ship, and how are they coordinated?**
- **How does classification work in Phase 2 before the Service DB exists?**
- **What's the public API surface for integrators?**
- **How do we keep it from leaking into production sessions accidentally?**

If we don't answer these now, the recorder code grows ad-hoc. We end up with
the watchers tightly coupled to Klaro internals, a classifier that doesn't
know about the future Service DB, and an API surface that won't survive the
move from Phase 2 → Phase 3 → Phase 4.

## Decision

### A. Activation: explicit opt-in plus a production-hostname warning

The recorder activates only when `config.record` is truthy. There is no
automatic "well, this looks like dev" detection — the developer says yes
explicitly. Default is `false`.

`record` accepts either `true` (defaults) or a `RecorderOptions` object:

```ts
interface RecorderOptions {
  /** Persist detections in sessionStorage (dev only). Default false. */
  persistInDev?: boolean;
  /** Suppress the production-hostname console.warn. Use only with reason. */
  silenceProductionWarning?: boolean;
  /** Cookie polling interval in ms. Default 1000. */
  cookieIntervalMs?: number;
  /** Periodic console.table summary cadence in ms. Default 30000. */
  summaryIntervalMs?: number;
}
```

`record: true` is shorthand for `record: { /* defaults */ }`.

In addition, on activation we check `location.hostname` against a list of
patterns that look like local/dev/staging hostnames (`localhost`, `127.*`,
`192.168.*`, `*.local`, `*.test`, `*.localhost`, IP-only hosts). If the
hostname doesn't match any of those, we emit a single `console.warn` warning
the developer that the recorder is running on what looks like a production
host. The recorder still activates — we trust the developer, but we make the
risk visible. `silenceProductionWarning: true` suppresses that warning when
the developer has a defensible reason (e.g., production-monitoring path,
section H below).

We do **not** use `process.env.NODE_ENV`. SimpleCMP is a library and we
don't control the consumer's bundler defines. The hostname heuristic is the
most reliable signal we can derive at runtime.

### B. Module structure: coordinator + watchers + classifier

```
src/recorder/
├── index.ts              ← public entrypoint, exports getRecorder()
├── recorder.ts           ← Recorder coordinator class (start/stop/snapshot)
├── classifier.ts         ← maps a raw detection to a known service or "unknown"
├── watchers/
│   ├── cookie-watcher.ts        ← polls document.cookie
│   ├── dom-watcher.ts           ← MutationObserver for <script>, <iframe>, <img>, <link>
│   └── network-watcher.ts       ← PerformanceObserver for resource entries
├── types.ts              ← Detection, RecorderEvents, etc.
└── recorder.test.ts      ← unit tests for the coordinator
```

The coordinator owns the lifecycle. It instantiates each watcher with a
shared sink (callback the watcher invokes when something is observed) and a
reference to the classifier. Watchers don't talk to each other; they only
report up. The classifier doesn't watch anything — it's a pure function
from raw detection to enriched detection.

This shape lets us:

- Test each watcher in isolation by feeding it synthetic events.
- Add or replace a watcher without touching the others.
- Swap the classifier (Phase 2: local-only; Phase 3: Service-DB-backed)
  without rewriting the watchers.

### C. Detection shape

A single normalized `Detection` type covers all watchers:

```ts
type DetectionKind = 'cookie' | 'script' | 'iframe' | 'image' | 'link' | 'request';
type DetectionStatus = 'known' | 'unknown';

interface Detection {
  kind: DetectionKind;
  identifier: string;        // cookie name, script src, etc.
  origin?: string;           // host of the resource (where applicable)
  firstSeen: number;         // Date.now()
  lastSeen: number;
  firstSeenOn?: string;      // location.pathname at firstSeen — answers
                             // "where on the site does this tracker show up"
  count: number;             // number of distinct observations
  matchedService?: string;   // Klaro service name that owns this
  matchedVendor?: string;    // future: vendor display name from Service DB
  status: DetectionStatus;
}
```

Detections are de-duplicated by `kind + identifier`. The first observation
creates the record, subsequent observations bump `lastSeen` and `count`.

The `firstSeenOn` field is the route on which the detection first appeared —
needed so customers can answer "which page caused this tracker to load?"
without re-running the recorder per route. Captured once at first sighting;
not updated on subsequent observations.

### D. Storage: in-memory by default, opt-in `sessionStorage` in dev

The recorder keeps a `Map<string, Detection>` keyed by `${kind}:${identifier}`.
By default nothing is persisted. The map is exposed via `getSnapshot()` for
tests, debugging, and the eventual CMS-bridge integration in Phase 4.

When `record: { persistInDev: true }` is set **and** the hostname heuristic
classifies the host as dev/local/staging, the recorder also writes the
serialized `Map` to `sessionStorage` after each new detection (debounced).
On activation it reads back any stored entries so the catalog survives a
page reload during a debugging session — a frequent customer ask. The
entry is keyed by `simplecmp.recorder.${storageName}` and tagged with a
schema version for future migrations.

We **never** persist outside that opt-in. We do not write to `localStorage`,
`IndexedDB`, or cookies. We do not persist on production hostnames even if
the flag is set — the heuristic gate is hard. The recorder must not change
browser state silently — that would interfere with the very thing it's
observing.

### E. Classification: local-only in Phase 2, Service-DB-augmented later

Phase 2 classifier:

1. For each `Detection`, walk `config.services` and check whether any
   service "claims" this identifier. Matching rules:
   - **Cookie**: service has a `cookies` field listing names or regex
     patterns; identifier matches one of them.
   - **Script/iframe/image/request**: service has an `origins` field
     listing hosts; the detection's `origin` matches one of them.
2. If a service matches, set `matchedService = service.name`, `status = 'known'`.
3. Otherwise `status = 'unknown'`. No vendor info available at this phase.

Phase 3 (REQ-8): the classifier additionally calls into the Service DB
client. The DB returns vendor metadata, which we merge into the detection.
Local matches still take priority (a site's own service config beats the
shared registry).

The classifier interface stays stable across phases:

```ts
interface Classifier {
  classify(raw: RawDetection): EnrichedDetection;
}
```

Phase 2 ships a `LocalClassifier`. Phase 3 ships a `LayeredClassifier` that
composes local + DB lookup. Both implement the same interface.

### F. Communication channels: three, with overlapping audiences

1. **`simplecmp.addEventListener('recorderDetection', handler)`** — same
   event-bus consumers already use for `consentVersionMismatch`. Fires for
   every new or updated detection. Recommended for integrators who want to
   pipe detections somewhere.

2. **`getRecorder()` API** — returns the live recorder instance with the
   following methods. Returns `undefined` when the recorder isn't active.

   ```ts
   interface Recorder {
     getSnapshot(): Detection[];
     clear(): void;
     on(event: 'detection', handler: (d: Detection) => void): void;
     off(event: 'detection', handler: (d: Detection) => void): void;

     // Customer-workflow utilities (see "K. Customer workflow utilities")
     exportConfig(): { services: KlaroServiceConfig[] };
     assertNoUnknown(): void;
   }
   ```

3. **Console logging** — when the recorder is active, it logs new
   detections to the console immediately and prints a periodic
   `console.table` summary every 30 seconds (configurable via
   `summaryIntervalMs`). Aimed at the developer using the recorder for its
   primary purpose: catalog auditing.

The three channels share the same underlying `Detection` data; nothing is
unique to one channel.

### G. Watcher details

**Cookie watcher**: polls `document.cookie` at a configurable interval
(default 1000 ms). Diffs against the previous observation. Reports new and
removed cookies. The `Cookie` API has no native event; polling is the only
portable approach. We deliberately accept the ~1 ms cost per second.

**DOM watcher**: a `MutationObserver` on `document.documentElement` watching
`childList: true, subtree: true`. For each added node, we check `tagName`
against the set `{ SCRIPT, IFRAME, IMG, LINK, AUDIO, VIDEO, SOURCE }`. We
extract the URL from `src` / `href` and report. Initial scan on activation
catches statically-rendered tags.

**Network watcher**: a `PerformanceObserver` for `entryTypes: ['resource']`.
Each resource entry has `name` (URL) and we derive `origin` from it.
Cross-origin entries are reported even if their headers were opaque —
that's intentional, the point is to know they happened.

All three watchers respect `start()` / `stop()`. Stopping detaches observers
and clears intervals; the in-memory `Map` is preserved for inspection.

### H. Production safety and the path to production monitoring

The recorder is observation-only. By itself, it does not transmit anything:

- `getRecorder()` returns `undefined` when the recorder isn't active. Code
  paths that depend on it must handle that (and the API documents it).
- We do not write to storage by default; opt-in `sessionStorage` (D) is
  hard-gated to dev/staging hostnames.
- We never make network requests of our own; we only observe.
- The recorder's only permanent effect is the in-memory `Map`, the watchers
  themselves, and (when explicitly opted in) a `sessionStorage` entry. All
  go away when `recorder.stop()` is called.

That said, **production monitoring is a deliberate downstream use case**, not
a forbidden one. Customers who want a "watchdog in production" pipeline run:

1. `record: { silenceProductionWarning: true }` on production builds.
2. Subscribe to `recorderDetection` events.
3. Forward unknown detections to a backend endpoint via Phase 4's CMS Bridge.

That's the supported path for "alert me when an unknown tracker shows up on
the live site". The recorder itself stays minimal and observation-only; the
egress and persistence concerns sit in CMS Bridge (Phase 4), which gets its
own ADR. This separation lets us tune dev-time and prod-time policies
independently — e.g., the CMS Bridge will dedupe per-day and respect a
sample rate, the recorder always sees everything in real time.

Phase 4 ADR work covers: egress shape, retry/backoff, CSP-friendly fetch,
auth, sample rate, dedupe windows, opt-out for high-traffic sites.

### I. TypeScript and code organization

The recorder is **new code, not derived from Klaro**. It lives in
`src/recorder/` (already in the layout) and is written in TypeScript from
the start. It does not modify `src/core/`. It does not depend on Klaro
internals beyond the public `getManager()` and the existing event bus.

This is deliberate: the recorder must be free to evolve without "respect
upstream Klaro" constraints from ADR-0002.

### J. Test approach

- Each watcher is unit-tested in isolation: mock `document.cookie` /
  dispatch synthetic mutations / push synthetic `PerformanceEntry`s. Verify
  the watcher reports the expected detections through its sink callback.
- The classifier is unit-tested with hand-crafted services and detections.
  Pure function; easiest layer to test thoroughly.
- The coordinator is integration-tested: real watchers, mocked sources,
  verify the snapshot map contains the expected detections.
- The `simplecmp.addEventListener('recorderDetection', ...)` path is
  already known-fragile in our test infra (Klaro's lib-event buffer leaks
  between tests). We test via `getRecorder().getSnapshot()` for the same
  reason we test `versionMismatch` via manager state in REQ-3.

### K. Customer workflow utilities

Two methods on the recorder address the workflows that customers actually
run, beyond "list what was detected":

**`recorder.exportConfig(): { services: KlaroServiceConfig[] }`**
Generate a Klaro-compatible service config from the current detections.
Each unknown detection becomes a stub service entry the developer can fill
in (purpose, vendor name, translations); each known detection is reproduced
verbatim from the existing config. Output is JSON-serializable so it can be
copy-pasted into a config file.

In Phase 2 the stubs are minimal:

```ts
{ name: '_ga', purposes: ['analytics'], cookies: ['_ga'] }
{ name: 'unknown-cdn-cloudflarescripts-com', origins: ['cdn.cloudflarescripts.com'] }
```

In Phase 3 the Service DB enriches stubs with real vendor names and
default purposes when matches are found. The method's signature stays the
same.

This turns "I scanned the site, now what?" into "copy this snippet into
your config".

**`recorder.assertNoUnknown(): void`**
Throws an `Error` that lists all current detections with `status === 'unknown'`.
Designed for CI/CD: run a headless browser through the user-flow, then call
this. Build fails if a new tracker appears that isn't in the configured
services. Forces deliberate consent updates rather than silent compliance
drift.

```ts
// In a Playwright test:
await page.goto('https://staging.example.com');
await page.evaluate(() => window.SimpleCMP.getRecorder()?.assertNoUnknown());
```

Both methods are pure reads of the snapshot — they don't change state, don't
emit events, don't transmit anything. Safe to call repeatedly.

## Consequences

### Positive

- Watchers, classifier, and coordinator are loosely coupled — easy to
  evolve, replace, or extend.
- Phase 3 (Service DB) and Phase 4 (CMS Bridge) plug into the same
  classifier interface and the same `Detection` shape. We don't rewire
  the recorder when those ship.
- Public API matches the existing event-bus pattern (`addEventListener`),
  so integrators don't learn a second mental model.
- `exportConfig()` and `assertNoUnknown()` turn the recorder from a
  passive observation tool into an active workflow tool. "I scanned, now
  what?" gets a real answer; CI gates on consent drift become a one-liner.
- `firstSeenOn` answers the customer question "where on the site does
  this tracker show up?" without re-running per route.
- Opt-in `sessionStorage` persistence in dev removes the most common
  customer frustration (catalog wiped on every page reload while
  debugging) without weakening production safety — the gate is hard.
- Hostname heuristic + explicit opt-in makes it nearly impossible to
  silently leak the recorder into production user sessions, while the
  documented production-monitoring path (H) keeps that use case open
  for customers who want it.

### Negative

- We polyfill nothing — old browsers that lack `MutationObserver` or
  `PerformanceObserver` simply won't be observed. Acceptable because
  the recorder is primarily a dev-time tool; modern browsers are the target.
- The cookie watcher polls. There's no event-based alternative pre-Cookie
  Store API. ~1 ms/second is a small cost we accept.
- The classifier interface is stable but its inputs (Klaro service config
  shape, future Service DB response shape) evolve. We'll need to map
  upstream Klaro changes carefully.
- The Recorder API surface (events, programmatic methods, console, plus the
  workflow utilities `exportConfig` / `assertNoUnknown`) is wider than a
  minimal tool. We accept this because each piece serves a distinct
  customer workflow and they all share the same underlying data.
- `exportConfig()` produces *stubs* in Phase 2 — purposes and vendor names
  are placeholders for unknown detections. Customer expectation needs to
  be set: this is a starting point, not a finished config. Phase 3 fills in
  the gaps via Service DB; Phase 2 still requires manual review.
- The opt-in `sessionStorage` persistence introduces a small schema-drift
  surface. Mitigated by the embedded schema-version field — incompatible
  reads fall through to a fresh start.

### Neutral

- The recorder is TypeScript while `src/core/` is JS+JSX. Tooling already
  handles both.
- The recorder doesn't auto-run anything on detection — it only reports.
  Decisions about what to do (block? warn? send to backend?) live in
  user code or in the future CMS Bridge module.
- The hostname-heuristic warning is a soft signal, not a hard gate. A
  developer can suppress it via `silenceProductionWarning: true` when
  recording on a staging domain that looks like production, or when
  intentionally running the production-monitoring path described in H.
- A future ADR for REQ-7+8+9 (proposed for when Phase 4 design begins)
  will revisit this architecture as a whole — the customer view is one
  product, and we may want to consolidate the design once we've shipped
  Phase 2 and learned from real usage.

## References

- REQ-7 — Record-Modus, in `docs/requirements.md`
- REQ-8, REQ-9 — Service DB and CMS Bridge, downstream consumers of this
  architecture
- ADR-0002 — Fork Klaro! as the consent UI engine (defines what's
  upstream-derived; the recorder is explicitly *not*)
- MDN: [`MutationObserver`](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver),
  [`PerformanceObserver`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)
- Cookie Store API (proposed; not yet broadly available):
  https://developer.mozilla.org/en-US/docs/Web/API/Cookie_Store_API
