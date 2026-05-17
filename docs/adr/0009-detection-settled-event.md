# 0009. Recorder emits `detectionSettled` after async classification

- **Status:** accepted
- **Date:** 2026-05-17
- **Deciders:** Ilja Melnicenko
- **Closes:** REQ-N7

## Context

The Recorder ingests raw observations from its watchers, runs them
through a `Classifier`, and emits a `'detection'` event so subscribers
can act on the result. Phase 2 shipped the `LocalClassifier` (synchronous,
matches against the integrator's `services[]`); Phase 3 added the
`LayeredClassifier` (REQ-8 / ADR-0005 G), which composes a remote
Service-DB lookup on top of the local match.

`LayeredClassifier.classify()` is *synchronously* — it has to be, because
the Recorder's `_ingest` is synchronous and the public `Classifier`
interface is synchronous. So when no local service matches, the
classifier returns `unknown` immediately and kicks off the DB lookup
fire-and-forget. When the lookup resolves with a hit, the classifier
invokes `recorder.enrichDetection(...)`, which patches the stored
detection and re-fires `'detection'` with the new status.

This is fine for consumers that re-render on every emission — the
recorder's BE devtools, the `getSnapshot()` callers, the consent-state
panel. They see the value flip from `unknown` to `known` and refresh.

It is *not* fine for the **CMS bridge**. The bridge POSTs a webhook the
moment it observes a `status: 'unknown'` detection. With both
`serviceDbUrl` and `cmsBridgeUrl` configured, this means: the first
emission of every previously-unseen tracker is `unknown` (because the
local services list typically doesn't cover the long tail), so the
bridge fires immediately — *before* the Service-DB has a chance to say
"that's just Google Analytics, ignore it." The dedup map prevents a
second POST after enrichment re-announces with `status: 'known'`, but
the first POST is already gone.

Symptom in production: CMS detection tables fill with rows for
textbook well-known trackers (`_ga`, `_fbp`, `_gid`, …) that the
shared Service-DB *does* recognise. Admins triaging the list see
noise that the system, in principle, knew was noise. Documented as
a "Known limitation" in `docs/cms-bridge-webhook.md` since v0.1; flagged
as REQ-N7 during the TYPO3 v0.2 integration testing.

Two competing fixes were on the table:

### Option A — `cmsBridge.gracePeriodMs`

A new option on the bridge: when an `unknown` detection arrives,
buffer it for N milliseconds. After the buffer expires, re-check the
current state; if a subsequent enrichment re-announce upgraded it to
`known`, drop. Otherwise POST.

Pros:
- Bridge-internal change. Recorder API unchanged.
- Default `0` preserves backwards-compatible behaviour.
- Gives admins a tuning knob for slow DBs.

Cons:
- The bridge has to second-guess timing. The "right" grace period
  depends on the DB's actual latency, which the bridge can't observe.
- A fixed grace period is wrong by construction: too short and the
  race still happens for slow DBs; too long and the bridge sits on
  events that were actually never going to be enriched (the DB
  responded "no match"), so genuinely-unknown trackers get delayed
  alerts.
- Re-implements *for the bridge alone* the "wait for classification
  to finish" semantics that the recorder already has internally.

### Option B — `'detectionSettled'` event

A new event on the recorder that fires *after* classification is
final. For detections that don't trigger an async lookup it follows
the `'detection'` event in the same tick; for detections where the
classifier kicked off a DB lookup it fires after that lookup resolves
(success, error, or no-match).

Pros:
- The recorder is the authoritative source of "is classification
  done?". The bridge stops second-guessing.
- No magic numbers. No tuning. The wait is exactly as long as the
  actual DB call takes — no more, no less.
- Generalises: a future consumer (e.g. an in-page diagnostic panel
  that should only render after classification is final) can use the
  same event.

Cons:
- Touches more surface: `Classifier` interface gains an optional
  field; `Recorder` gains a second listener set and a new event;
  bridge wiring changes.
- Existing `'detection'` consumers are unaffected, but the new event
  has to be documented for downstream integrators.

## Decision

**Option B.** The Recorder emits `'detectionSettled'` after the
classifier's optional `pending` promise resolves (or immediately if
`pending` is absent). The CMS bridge subscribes to `'detectionSettled'`
in place of `'detection'`.

The mechanism is a small, additive extension to the `Classifier`
interface:

```ts
export interface Classifier {
  classify(raw: RawDetection): {
    matchedService?: string;
    matchedVendor?: string;
    status: DetectionStatus;
    pending?: Promise<void>;  // ← new
  };
}
```

`LocalClassifier` omits the field. `LayeredClassifier` returns a
`pending` whenever it kicks off a DB lookup. The promise always
resolves (never rejects) — consumers only care about the *signal*,
not the outcome.

The Recorder reads `pending` once at ingest time:

```ts
if (pending) {
  pending.finally(() => this._announceSettled(key));
} else {
  this._announceSettled(key);
}
```

`_announceSettled(key)` reads the *current* state of the stored
detection from the map (which may have been patched by
`enrichDetection` between initial announce and now), so subscribers
see the post-enrichment state without the recorder needing to
correlate enrichment events with pending promises explicitly. The
ordering is guaranteed by the promise chain: `LayeredClassifier`'s
internal `.then(dispatch)` runs *before* the recorder's `.finally`,
because the latter is attached to the chained promise.

## Consequences

### Positive

- The CMS bridge stops generating false positives for trackers the
  shared Service-DB recognises. Per the e2e test, a fresh pageload
  with 12 cookies (6 library-known, 6 truly unknown) results in 6
  POSTs, not 12.
- The "Known limitation" block in `cms-bridge-webhook.md` is gone,
  replaced by a "Coordination with the Service DB" section that
  describes deterministic behaviour.
- The `Classifier` interface extension is forward-compatible: future
  classifiers that introduce other async work (e.g. a remote
  fingerprint-detection lookup) can opt in by returning their own
  `pending` without further recorder changes.

### Negative

- The bridge's first POST for any given unknown tracker is delayed by
  the DB-lookup latency (typically tens to a few hundred milliseconds
  in same-install setups). In practice this is invisible — the
  bridge is monitoring telemetry, not real-time UI — but it is a
  shift from "POST as soon as the watcher sees it" to "POST after
  classification settles."
- The recorder now maintains two listener sets (`listeners` for
  `'detection'`, `settledListeners` for `'detectionSettled'`). Trivial
  bookkeeping cost, but adds one branch to the `on()`/`off()` path.

### Neutral

- Existing `'detection'` consumers are unchanged. The original event
  still fires with its original timing, including the
  enrichment-driven re-emission. Downstream code that wants the
  early-and-eventually-corrected stream (e.g. the recorder devtools)
  stays on `'detection'`; code that wants single-fire-after-settle
  (the bridge) uses `'detectionSettled'`. Both audiences are served.

## References

- REQ-N7 in `docs/requirements.md`
- `docs/cms-bridge-webhook.md` — section "Coordination with the Service DB"
- Implementation: `src/recorder/recorder.ts`,
  `src/service-db/layered-classifier.ts`, `src/cms-bridge/bridge.ts`,
  `src/index.ts`
- Initial discussion + design pick: 2026-05-17 session
