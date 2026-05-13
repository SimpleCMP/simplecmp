/**
 * Service DB public entry — REQ-8 / ADR-0005.
 *
 * Re-exports the surface that `src/index.ts` and (eventually) external
 * consumers via the `simplecmp/service-db` subpath import.
 */

export { ServiceDbClient } from './client.js';
export { LayeredClassifier } from './layered-classifier.js';
export type { Enrichment, EnrichmentListener } from './layered-classifier.js';
export type {
  Extensions,
  HealthResponse,
  I18nMap,
  LookupQuery,
  LookupResult,
  LookupResultItem,
  Purpose,
  Retention,
  ServiceDbAuth,
  ServiceDbClientOptions,
  ServiceDetail,
  ServiceList,
  ServiceMatch,
  ServiceMatchSources,
} from './types.js';
