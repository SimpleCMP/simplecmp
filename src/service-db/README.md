# src/service-db/

Client for the **Service DB** — a shared registry of well-known cookies and external
services (Google Analytics, Matomo, YouTube, Stripe, etc.).

## Planned API

```ts
import { lookup } from 'simplecmp/service-db';

const result = await lookup({ cookie: '_ga' });
// → { service: 'Google Analytics', purpose: 'analytics', vendor: 'Google LLC', ... }
```

## Architecture

The client fetches from a configurable endpoint (default: a publicly hosted SimpleCMP
registry). Responses are cached in `localStorage` with a TTL.

The registry itself is maintained in a separate repository (TBD) as a versioned JSON
dataset, with community contributions.

## Status

Phase 3 of the roadmap.
