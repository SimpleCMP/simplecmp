/**
 * CMS Bridge module — REQ-9.
 *
 * Public surface: the `CmsBridge` class (used internally by `init()`, but
 * also constructable by integrators who want to drive it themselves) plus
 * the option/payload types so receiver code can be typed against them.
 */

export { CmsBridge } from './bridge.js';
export type { CmsBridgeAuth, CmsBridgeOptions, CmsBridgePayload } from './types.js';
