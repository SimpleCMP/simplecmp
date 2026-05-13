/**
 * Service DB protocol types — REQ-8 / ADR-0005.
 *
 * Mirror of the HTTP/JSON contract documented in
 * `docs/service-db-protocol.md`. Authored from the protocol spec; kept
 * intentionally narrow so a backend can return a superset (extensions,
 * unknown fields) without breaking the client.
 */

/**
 * Localized string. Canonical English is required at the top level of the
 * containing object; this `i18n` map carries optional translations.
 */
export type I18nMap = Record<string, string>;

/** Purpose taxonomy — small fixed set per ADR-0005 section D. */
export type Purpose =
  | 'functional'
  | 'analytics'
  | 'marketing'
  | 'personalization'
  | 'security'
  | 'advertising';

/** What backends MAY include in `extensions`. Plugins SHOULD vendor-prefix keys. */
export type Extensions = Record<string, unknown>;

/** Retention metadata — display string is canonical, machine-readable optional. */
export interface Retention {
  display: { en: string } & Partial<I18nMap>;
  durationDays?: number;
}

/** Why an entry matched a query (cookies / origins it claims). */
export interface ServiceMatchSources {
  cookies?: string[];
  origins?: string[];
}

/** A single service registry entry. Returned from /v1/lookup and /v1/services. */
export interface ServiceMatch {
  id: string;
  name: string;
  vendor?: string;
  vendorCountry?: string;
  purposes: Purpose[];
  privacyPolicyUrl?: string;
  description?: string;
  retention?: Retention;
  i18n?: {
    name?: I18nMap;
    description?: I18nMap;
  };
  matches?: ServiceMatchSources;
  extensions?: Extensions;
}

/** Service detail (currently same shape as ServiceMatch; reserved for divergence). */
export type ServiceDetail = ServiceMatch;

/** /v1/services listing wrapper. */
export interface ServiceList {
  items: ServiceMatch[];
  total: number;
  limit: number;
  offset: number;
}

/** A single lookup query. Provide `cookie` OR `origin`, not both. */
export interface LookupQuery {
  cookie?: string;
  origin?: string;
}

/** /v1/lookup response item — positionally aligned with the request items. */
export interface LookupResultItem {
  query: LookupQuery;
  matches: ServiceMatch[];
}

export interface LookupResult {
  items: LookupResultItem[];
}

/** /v1/health response. */
export interface HealthResponse {
  ok: boolean;
  schemaVersion: number;
  count?: number;
}

/** Auth options for the client. */
export interface ServiceDbAuth {
  /** Token sent in the auth header. */
  token: string;
  /** HTTP header name. Default `Authorization` (with `Bearer` prefix). */
  header?: string;
  /** Override the value scheme. Default `Bearer ${token}`. */
  scheme?: 'Bearer' | string;
}

/** ServiceDbClient construction options. */
export interface ServiceDbClientOptions {
  /** Base URL ending without trailing slash. e.g. `https://my-cms/api/simplecmp/db`. */
  url: string;
  /** Optional auth. */
  auth?: ServiceDbAuth;
  /** Cache TTL in ms; default 24h. */
  cacheTtlMs?: number;
  /** Network timeout per request in ms; default 3000. */
  timeoutMs?: number;
  /** Major API version. Default `'v1'`. */
  apiVersion?: 'v1';
  /** Override `globalThis.fetch`. Tests inject; runtime uses the global. */
  fetch?: typeof fetch;
  /** Override `globalThis.localStorage`. Tests can pass a stub. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Override `Date.now` for deterministic cache-expiry tests. */
  now?: () => number;
}
