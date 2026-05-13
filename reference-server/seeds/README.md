# Service-DB Seeds

One JSON file per service, ingested into SQLite by `Seeder` on first run.
Replace the file → restart the server (or delete the SQLite file) → reload.

## Schema

```jsonc
{
  "id":       "kebab-case-stable-id",       // required, unique
  "name":     "Vendor's product name",      // required, canonical EN
  "vendor":   "Legal name of the controller",
  "vendorCountry": "US",                    // ISO 3166-1 alpha-2
  "purposes": ["analytics"],                // see ../../docs/service-db-protocol.md
  "privacyPolicyUrl": "https://...",
  "description": "What the service does (canonical EN).",
  "retention": {
    "display": { "en": "26 months", "de": "26 Monate" },
    "durationDays": 791                     // optional
  },
  "i18n": {
    "name":        { "de": "Localized name (only if it differs)" },
    "description": { "de": "Lokalisierte Beschreibung." }
  },
  "matches": {
    "cookies": ["_ga", "/_ga_/", "_gid"],   // exact OR /regex/
    "origins": ["www.google-analytics.com", "*.googletagmanager.com"]
  }
}
```

### `matches.cookies`

- Plain string → exact name match.
- `/pattern/` (string starting and ending with `/`) → regex source.

### `matches.origins`

- Plain host (`www.example.com`) → exact host match.
- `*.example.com` → suffix match (matches `www.example.com`,
  `cdn.example.com`, AND bare `example.com`).
- `/pattern/` → regex against the host.

## Contributing a new service

1. Copy an existing seed in `services/` as a starting point.
2. Verify cookie names + origins from the vendor's docs (not from
   advertising literature).
3. Use real privacy-policy URLs.
4. Submit a PR. CI validates the JSON against the schema.

License of seed JSON: BSD-3-Clause, matching the rest of SimpleCMP.
