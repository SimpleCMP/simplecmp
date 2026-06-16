/**
 * Visitor UUID generation + persistence — Phase 2 audit trail.
 *
 * The consent-log POSTs a stable per-visitor identifier so the host
 * can dedupe "visitor confirms identical consent five times" into a
 * single audit row while genuine changes ("visitor flipped from
 * Accept to Decline") become fresh rows.
 *
 * The raw UUID is generated client-side via `crypto.randomUUID()`
 * (RFC 4122 v4) and persisted in the visitor's own `localStorage`
 * under `${storageName}-visitor-uuid`. The host **never sees the
 * raw UUID in storage** — it gets it in the POST body and immediately
 * HMACs it with the bridge secret + source before insertion. The
 * pseudonymized hash is what lives in the DB, the raw UUID stays on
 * the visitor's device. DSGVO Art. 15 Auskunftsrecht is served by
 * the visitor presenting their own UUID (visible in localStorage),
 * with which the host can recompute the hash and find their rows.
 *
 * Fallback path: when `localStorage` throws (private-browsing strict
 * mode, quota exceeded), the function returns an ephemeral per-call
 * UUID. The audit row still lands; only cross-session dedup for that
 * visitor is lost (acceptable — better an unjoined row than none).
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Return the visitor's stable UUID, creating + persisting one on
 * first call. Idempotent for the same `storageName` argument within
 * a single browser profile.
 */
export function getOrCreateVisitorUuid(storageName: string): string {
  const key = visitorIdStorageKey(storageName);
  const existing = readSafe(key);
  if (existing !== null && UUID_REGEX.test(existing)) {
    return existing;
  }
  const fresh = generateUuid();
  writeSafe(key, fresh);
  return fresh;
}

/**
 * Expose the storage-key derivation so a Phase-3 DSGVO-Auskunfts
 * workflow can guide the visitor "look in localStorage under this
 * key, copy the value, paste it into the request form".
 */
export function visitorIdStorageKey(storageName: string): string {
  return `${storageName}-visitor-uuid`;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Polyfill path — happens only in ancient browsers / test stubs
  // that don't supply `crypto.randomUUID`. Use crypto.getRandomValues
  // when available so the bytes are at least cryptographically
  // random; final fallback to Math.random() which is documented as
  // not suitable for security but adequate for an audit-row dedup id
  // (the secret is server-side anyway).
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Force v4 + variant bits per RFC 4122. Non-null asserts: `bytes`
  // is a fixed-size Uint8Array we just allocated; indices 6 and 8
  // are always present, TS just can't prove it.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function readSafe(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSafe(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded / private-browsing strict — accept the loss of
    // cross-session dedup for this visitor. The audit row still lands
    // on each POST, just with a fresh (different) UUID per session.
  }
}
