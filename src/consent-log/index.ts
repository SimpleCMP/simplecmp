/**
 * Consent-Log module — Phase 2 audit trail.
 *
 * Public surface: the {@link ConsentLogger} class (constructed
 * internally by `init()` when `config.consentLog?.url` is set, but
 * also exposed for custom integrations) plus the option /
 * payload types so host receiver code can type against them, and the
 * visitor-id helper for advanced flows that want to manage the
 * UUID themselves.
 */

export { ConsentLogger } from './logger.js';
export { getOrCreateVisitorUuid, visitorIdStorageKey } from './visitor-id.js';
export type {
  ConsentLogConfig,
  ConsentLogOptions,
  ConsentLogPayload,
  SaveConsentsNotification,
} from './types.js';
