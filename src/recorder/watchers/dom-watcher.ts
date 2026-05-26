/**
 * DOM watcher — REQ-7 / ADR-0004 section G.
 *
 * `MutationObserver` on `document.documentElement` watching `childList`
 * changes throughout the subtree. For each added node whose tag is one of
 * the known resource-loading tags, extract `src`/`href` and report.
 *
 * On `start()` we also scan tags already in the DOM so statically-rendered
 * resources are caught.
 */

import type { DetectionKind, DetectionSink, RawDetection, Watcher } from '../types.js';

/** Map of tag-name → detection kind. Tags not in this map are ignored. */
const TAG_TO_KIND: Record<string, DetectionKind> = {
  SCRIPT: 'script',
  IFRAME: 'iframe',
  IMG: 'image',
  LINK: 'link',
  AUDIO: 'request',
  VIDEO: 'request',
  SOURCE: 'request',
  TRACK: 'request',
  EMBED: 'request',
  OBJECT: 'request',
};

/** Read the URL attribute appropriate for the given tag. */
function urlForTag(el: Element): string | undefined {
  const tag = el.tagName;
  if (tag === 'LINK') {
    return (el as HTMLLinkElement).href || undefined;
  }
  // Most other tags use `src`. <object> uses `data`.
  if (tag === 'OBJECT') {
    return (el as HTMLObjectElement).data || undefined;
  }
  // src attribute via getAttribute (so we get the raw URL even when the
  // computed `el.src` would resolve to the page origin).
  const raw = el.getAttribute('src');
  if (!raw) return undefined;
  // If raw is a relative URL, treat it as same-origin — same-origin loads
  // aren't interesting for the recorder. We return only when it parses as
  // an absolute URL.
  try {
    return new URL(raw, location.href).href;
  } catch {
    return undefined;
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    // `hostname` (port-stripped) — see network-watcher's matching comment.
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export interface DomWatcherOptions {
  /** Override the root that's observed. Defaults to `document.documentElement`. */
  root?: Element;
}

export class DomWatcher implements Watcher {
  private readonly sink: DetectionSink;
  private readonly root: Element | null;
  private observer?: MutationObserver;
  private readonly seen = new Set<string>();

  constructor(sink: DetectionSink, options: DomWatcherOptions = {}) {
    this.sink = sink;
    this.root = options.root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  }

  start(): void {
    if (!this.root || this.observer) return;
    this._initialScan();
    if (typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver((mutations) => this._onMutations(mutations));
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
  }

  private _initialScan(): void {
    if (!this.root) return;
    const tags = Object.keys(TAG_TO_KIND).join(',');
    const elements = this.root.querySelectorAll(tags);
    for (const el of Array.from(elements)) this._handleElement(el);
  }

  private _onMutations(mutations: MutationRecord[]): void {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
        const el = node as Element;
        this._handleElement(el);
        // Also walk descendants — a freshly inserted subtree may contain
        // resource-loading tags below the root.
        if (el.querySelectorAll) {
          const tags = Object.keys(TAG_TO_KIND).join(',');
          for (const descendant of Array.from(el.querySelectorAll(tags))) {
            this._handleElement(descendant);
          }
        }
      }
    }
  }

  private _handleElement(el: Element): void {
    const kind = TAG_TO_KIND[el.tagName];
    if (!kind) return;
    const url = urlForTag(el);
    if (!url) return;
    const origin = safeOrigin(url);
    if (!origin) return;
    // Same-origin resources aren't trackers in the consent sense; skip.
    if (typeof location !== 'undefined' && origin === location.hostname) return;
    const key = `${kind}:${url}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const raw: RawDetection = {
      kind,
      identifier: url,
      origin,
      firstSeenOn:
        typeof location !== 'undefined' ? location.pathname + location.search : undefined,
    };
    this.sink(raw);
  }
}
