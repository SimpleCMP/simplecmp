# Runtime patches — ADR-0013

The runtime-patch half of universal pre-consent blocking. Shipped
2026-05-21 (Phase 2). Patches six browser API surfaces so JS-injected
third-party calls go through the same consent check as declarative
tags:

- `HTMLScriptElement.prototype.src` setter
- `HTMLIFrameElement.prototype.src` setter
- `HTMLImageElement.prototype.src` setter — catches `new Image()`,
  `img.src = '...'`, and any code that mutates an existing img element
- `window.fetch`
- `XMLHttpRequest.prototype.open` (with `.send` no-op for flagged
  instances)
- `navigator.sendBeacon`

See `index.ts` for the implementation. ADR-0013 captures the strategic
why; this README documents what Phase 0 actually proved + the
fragility surface we found while building it.

## Demo

`demos/runtime-patches.html` exercises all six patches with a mock
matcher (recognises `*.third-party.test`) and a toggleable consent
state. Run via:

```sh
pnpm build               # produces dist/runtime-patches.mjs
node demos/serve.mjs     # serves demos/ + dist/ on :5173
```

Open `http://localhost:5173/runtime-patches.html`. With consent
denied (default), all six test buttons surface "blocked" log lines.
Toggle consent → re-run → calls pass through.

## Phase 0 measurement

Three observations from driving the demo:

1. **All six mechanisms catch their target calls.** No false negatives
   in the basic injection patterns. The `xhr` send no-op is a slight
   stretch (we mark the instance at open() time and silently drop
   send()) — a strict caller checking `xhr.readyState` could detect
   it, but no real-world tracking script does.
2. **Pass-through is silent.** When consent is granted (or the host
   doesn't match), patched calls behave identically to native. No
   network overhead, no console noise.
3. **Same-origin defaults to pass-through.** `window.location.host`
   is in the default `sameOriginHosts`. Sites that own multiple
   hostnames (CDN, vendor's own infrastructure) pass them via the
   `sameOriginHosts` option.

## Fragility surface (the gaps the patches DON'T catch)

Documented so we have an honest "this is best-effort, not bulletproof"
story when productionising:

- **Inline scripts that build URLs by string concatenation.** Same
  blind spot as the server-side rewriter. If a third-party loader
  computes `'https://' + cdn + '/x.js'` and assigns to `script.src`,
  the patch sees the final string and matches correctly. But if the
  computation happens AFTER the patch has been installed AND uses
  `eval()` or `new Function()`, we have no way to observe the URL
  until the network call fires. Rare in modern third-party libraries
  but possible.
- **Loaders that bypass `document.createElement`.** Rare. The
  legitimate way to inject a script is `createElement('script')`;
  alternatives include writing into an existing element's `outerHTML`
  (the parser then creates a new script element — and that flows
  through our prototype patch because the `src` is set during parse).
  `document.write()` is the one exception that can fire a request
  before the patch has a chance — but `document.write` after page
  parse is nearly extinct in modern third-party code.
- **Service Workers controlled by the host site.** If the site
  registers its own SW, that SW can issue any network request
  outside our patch scope. We can't reach the SW context from a
  patched page. Out of scope for SimpleCMP's blocking story; sites
  with their own SWs need to gate their own requests.
- **Direct WebSocket / EventSource / WebRTC.** Not patched. Tracking
  typically doesn't use these channels but it's a known gap.
- **The first-script-ordering constraint.** The patch only works for
  scripts that execute AFTER `installRuntimePatches()` finishes. The
  host page must load this module synchronously in `<head>` BEFORE
  any third-party loader. That's the same constraint
  Klaro/SimpleCMP's banner-init has — load first, gate everything
  else.

## How to use

```ts
import { init } from 'simplecmp';

init({
  storageName: 'simplecmp-site',
  services: [
    { name: 'analytics', origins: ['analytics.example.com'] },
    { name: 'video', origins: ['*.youtube.com', '*.ytimg.com'] },
  ],
  interceptRuntime: {
    sameOriginHosts: ['cdn.mysite.example'],
    onBlock: (info) => console.debug('[simplecmp] blocked', info),
  },
});
```

`interceptRuntime: true` is equivalent to `interceptRuntime: {}` with
default same-origin (`[window.location.host]`) and no `onBlock`
hook. The matcher is built once from `config.services[].origins` at
`init()` time and uses the same wildcard semantics as the recorder
(`src/recorder/classifier.ts::originMatches`).

Consent is read live on every patched call via
`manager.getConsent(serviceId)`, so toggling a service via the
banner / modal takes effect for the next request without
re-initing.

`handle.destroy()` removes the patches and restores the native
prototype methods.
