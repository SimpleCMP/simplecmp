/**
 * SimpleCMP Lit UI — public surface.
 *
 * REQ-14 / ADR-0007. This module is loaded by the new UI entry point in
 * `src/index.ts` (D.5). For now it only exports the foundation pieces
 * — concrete components land in D.2–D.4.
 *
 * Headless consumers (REQ-N2) keep importing from `simplecmp/engine` and
 * never load this module — none of the Lit runtime is in their bundle.
 */

export { SimpleCmpElement } from './base.js';
export { SimpleCmpBanner } from './components/banner.js';
export { SimpleCmpContextualNotice } from './components/contextual-notice.js';
export { SimpleCmpModal } from './components/modal.js';
export { SimpleCmpPolicyLinks } from './components/policy-links.js';
export { SimpleCmpPurposeGroup } from './components/purpose-group.js';
export { SimpleCmpServiceToggle } from './components/service-toggle.js';
export { SimpleCmpTrigger } from './components/trigger.js';
export { bindTranslator } from './i18n-bridge.js';
export type { Translator } from './i18n-bridge.js';
export { initLit } from './init.js';
export type {
  FloatingTriggerOptions as LitFloatingTriggerOptions,
  LitInitConfig,
  LitInitHandle,
} from './init.js';
export { tokens } from './styles/tokens.js';
