# Blocked-embed placeholder feature — competitive + legal research

**Date:** 2026-05-27
**Author:** research run via multi-agent parallel investigation
**Scope:** the post-consent / pre-consent UI surface that replaces a blocked iframe
or script with a "click to enable" placeholder. Not the cookie banner itself.

## Why this exists

SimpleCMP already ships a basic `<simplecmp-contextual-notice>` element (per
[`click_to_enable_blocked_services`](../adr/) / commits `1c99f35`, `f148528`,
`78a64b0` in May 2026). Open questions we collected before extending it for
v1.0:

- Per-embed admin customization (title, description, preview image) — is anyone
  in the market doing it, and how?
- Auto-fetched thumbnails for YouTube / Vimeo / Spotify — privacy-correct path?
- DSGVO copy minimums — what does the placeholder actually have to say?
- Architectural patterns worth borrowing.

Four research agents ran in parallel: a deep-dive on Borlabs Cookie (the
incumbent DACH WordPress CMP), a deep-dive on Real Cookie Banner (the strongest
competitor), a comparative survey of eight commercial CMPs, and a DACH legal
landscape pass. Plus an open-source CMP landscape sweep.

## Executive synthesis

Five things that changed the design space:

1. **Per-instance admin overrides is an unclaimed lane.** Zero of the eight
   commercial CMPs surveyed (Borlabs, RCB, Cookiebot, Usercentrics, Complianz,
   CCM19, Cookie Information, OneTrust, iubenda, CookieYes) ship per-instance
   customization. Customization is locked at the per-service level. Even the
   open-source competitors (Klaro, tarteaucitron, iframemanager) max out at
   `data-iframe-*` attribute forwarding — not per-instance content overrides.

2. **DSGVO-compliant default copy is also an unclaimed lane.** None of the
   eight ships a placeholder that fully satisfies DSGVO Art. 13 disclosure
   minimums (named recipient, data categories, third-country + safeguard,
   privacy-policy link) at the point of the consent click. All defer the
   legal disclosure to the modal or the cookie-declaration page — which
   contradicts the DSK's "disclosure on the same layer as the action"
   principle. Library-curated correct German default copy would be a
   measurable differentiator.

3. **RCB's "Hero" layout is the UX gold standard.** Thumbnail-mimicking
   placeholder with a single play-button click = consent + auto-load. Black
   play button (not YouTube-red) for trademark distance. Embed Privacy
   already implements the WordPress equivalent (GPL-2+).

4. **Server-side thumbnail fetching is legally clean; hotlinking is not
   pre-consent.** Server-side fetch never exposes visitor IP to YouTube;
   hotlink (`<img src="i.ytimg.com/...">`) leaks visitor IP on every
   page-load before consent. Copyright on the cached thumbnail is murky,
   though — the pragmatic recommendation is generic-placeholder-by-default
   + admin opt-in for the real thumbnail.

5. **Klaro upstream is dead-ish.** Still on 0.7.22 (March 2024). Our
   divergence is permanent. The `data-name` + `data-src` pattern we
   inherited is the cross-CMP convention — also used by tarteaucitron,
   iframemanager, Drupal modules, the WapplerSystems TYPO3 integration.

## Proposed design shape (discussion notes, not yet locked)

Captured here for traceability when this turns into a REQ.

- **Two layout modes per service:** `hero` for media (thumbnail-mimicking
  card with play-button) and `wrapped` for non-media (transparent overlay
  around original content). Library curates the default per service;
  admin can override globally per service.
- **Per-instance overrides via plain data attributes** on the embed itself
  (`data-simplecmp-title`, `-description`, `-preview-image`, `-mode`).
  CMS-agnostic. TYPO3 / Gutenberg / Contao plugins become thin emitters.
- **Library entry schema extension** to carry DSGVO copy:
  `controller`, `dataCategories`, `thirdCountry.basis`, `placeholderCopy.<lang>`.
- **Server-side thumbnail fetcher** as a CMS-plugin concern (not library);
  off-by-default per service.
- **One-click consent is sufficient** — legal agent confirmed no two-step
  modal is required if the disclosure is visible before the click.

Open questions to resolve before locking the REQ:
1. Ship thumbnail fetcher in this iteration or later?
2. Hero default for which services beyond YouTube/Vimeo?
3. Ship the Wrapped variant now or stick with Hero + current text-card?
4. Full legal paragraph as library default, or compact 3-line summary?
5. Bulk-stub the 369 library entries or service-by-service curation?
6. Thumbnail copyright: hotlink, server-cache, or generic-placeholder default?

---

# I. Borlabs Cookie — focused analysis

## Executive summary

Borlabs's Content Blocker is a per-service (not per-embed) template system:
each blocker is a library entry with `name`, `description`,
`privacy_policy_url`, `hosts`, plus a fully editable `preview_html` /
`preview_css` placeholder template using `%%name%%` /
`%%privacy_policy_url%%` variables — admins customize the *blocker*, not
the individual embed instance, and a single shortcode `[borlabs-cookie
type="content-blocker"]` is the only per-instance lever. **Steal:** the
`preview_html` template variable system (gives admins design freedom
without per-embed surface area), Real Cookie Banner's "Hero" layout that
auto-downloads YouTube thumbnails server-side and outputs them locally,
and Cookiebot's idea of a single `data-` attribute triggering a sized
placeholder. **Skip:** Borlabs's "all-or-nothing per service" model (one
preview per service, no per-instance title/description overrides) — this
is exactly the gap your contextual-notice design is poised to fill, and
it's actively missing from every commercial competitor we checked.

## 1. End-to-end visitor experience for a blocked embed

Verified from the iframe demo page
([borlabs.io/borlabs-cookie/iframe-demo/](https://borlabs.io/borlabs-cookie/iframe-demo/)):
every blocked iframe renders an identical placeholder shape:

- A short body sentence: *"You are currently viewing a placeholder content
  from \[SERVICE NAME\]. To access the actual content, click the button
  below. Please note that doing so will share data with third-party
  providers."*
- Three buttons:
  1. **"More Information"** — opens a privacy/info link (the per-blocker
     `privacy_policy_url`)
  2. **"Unblock content"** — opens the full Borlabs settings/banner modal
  3. **"Accept required service and unblock content"** — single-click
     opt-in for just this service (their two-step flow)

No thumbnail in the default placeholder. The demo page does not show
YouTube thumbnails, Vimeo posters, or Google Maps preview tiles inside
the placeholder. The placeholder is a styled rectangle with text +
buttons. The placeholder *can* be replaced with arbitrary HTML by an
admin editing `preview_html`, but it is not auto-thumbnailed.

## 2. Per-instance admin customization — the key gap

There is no first-class "customize this embed instance" UI in Borlabs.
Per-instance customization is limited to a single shortcode attribute:
`[borlabs-cookie type="content-blocker" title="An image"]`, with `title`
overriding the displayed heading. No description, no preview-image
override, no button-label override at the instance level.

A Borlabs config gist
([timohubois gist](https://gist.github.com/timohubois/d58d8c11ed671bba07f64d75aa576178))
shows the complete content-blocker field set is per-blocker, not
per-instance:

```
id, content_blocker_id, language, name, description,
privacy_policy_url, hosts, preview_html, preview_css,
global_js, init_js, settings, status, undeletable
```

The `preview_html` field contains a Mustache-style template with
`%%name%%` and `%%privacy_policy_url%%` placeholders — admin edits the
template once per service and every instance uses it.

Real Cookie Banner is the same
([devowl KB](https://devowl.io/knowledge-base/real-cookie-banner-create-individual-content-blocker/)):
admin fields are Name / Description / URLs to block / Connected cookies —
all per-blocker, none per-instance.

## 3. Thumbnail / preview-image handling

Borlabs does not auto-fetch thumbnails. The default `preview_html`
template is text + buttons on a styled rectangle. An admin can paste a
`<img>` into `preview_html` (per-service), but there is no thumbnail
fetcher.

Real Cookie Banner since v3.0 ships a "Hero" layout with an explicit
setting "Download preview image and output locally"
([devowl 3.0 release](https://devowl.io/news/real-cookie-banner-3-0/)) —
server-side fetch + local file output, privacy-safe.

Complianz / Cookiebot both support custom placeholder images but it's
admin-uploaded, not auto-fetched.

## 4. Multi-language

Every Borlabs content blocker entry has a `language` field —
translations are managed as separate blocker entries per language, not
as overlay strings on one entry. Same with services. For a site with 5
languages, an admin maintains 5× the rows.

SimpleCMP's current shape (canonical English `placeholderDescription`
plus `i18n.placeholderDescription.<lang>` overlays) is materially better
than Borlabs's per-language-row model.

## 5. Two-step / per-service opt-in

Borlabs has it via the "Accept required service and unblock content"
button. Clicking grants consent for just that service and unblocks the
embed without opening the cookie banner. No modal interception, no
second click.

The 3-button UX is verbose. Real Cookie Banner has the same one-click-
accept flow but condenses it (Hero layout: clicking the play button on
the YouTube-look-alike accepts and loads).

## 6. Compliance angles

German legal frame is now TDDDG (replaces parts of TMG), enforced
alongside GDPR. DSK guidance applies. Placeholder copy should
communicate:

1. Identity of the data recipient (e.g. "Google Ireland Limited")
2. What data is transferred — at minimum IP address; for video also
   viewing behavior
3. Purpose of the processing
4. Third-country transfer notice for US-based services (Schrems II)
5. Link to the recipient's privacy policy
6. Click is unambiguous and informed — placeholder text readable
   *before* the click

Borlabs's default copy mentions "share data with third-party providers"
but does not name the recipient legal entity or list data fields.

## 7. Pre-built library coverage

Marketing claims "Over 300 settings" and an integrated library; exact
service count not surfaced in their docs. Big-N (YouTube, Vimeo, Maps,
Facebook, Instagram, Twitter, Soundcloud, Spotify) covered.

Real Cookie Banner publishes "100+ service templates"; we ship 369
library entries with multi-TLD `aliasOrigins` — comparable or larger.

## 8. Pricing & open-source policy

Closed-source commercial. Four tiers, €49/year (1 site) to €499/year (99
sites), annual subscription. No free tier, no public demo install. Source
code not published. Reviewers noted a ~250% price hike at one point that
triggered substantial backlash.

## 9. Other German-market CMPs worth comparing

See sections III (commercial survey) and IV (open-source landscape).

## 10. Learn-from-the-mistakes

From G2 / TrustRadius / OMR reviews:

1. **"Programming knowledge required"** for non-trivial Content Blockers.
   The custom `preview_html` field is HTML+CSS+JS — admins routinely
   complain it's too technical.
2. **Per-language management is duplicative.** Borlabs and RCB both make
   admins maintain N copies.
3. **No cookie scanner** is a recurring complaint about Borlabs.
4. **All-YouTube-at-once unlock** is the spec-correct behavior (consent
   is per-service) but reviewers find it surprising.
5. **Price-hike backlash.**
6. **3-button placeholder is verbose.** "More Information / Unblock
   content / Accept required service" is too many CTAs. Real Cookie
   Banner's Hero is cleaner.

## Steal / Skip / Add (Borlabs lens)

**Steal:**
- Real Cookie Banner's server-side thumbnail download for media services
- Borlabs's `preview_html` template variable convention as power-user
  escape hatch (`%%title%%`, `%%description%%`, `%%privacyPolicyUrl%%`,
  `%%previewImage%%`)
- Three-tier compliance copy in the library entry: recipient legal
  entity + data categories + privacy policy URL, baked into
  `placeholderDescription` defaults

**Skip:**
- Per-language-row model — i18n overlay is materially better
- 3-button placeholder — collapse to 2 (accept + settings) with inline
  privacy link
- Per-instance customization-via-shortcode — use data attributes on the
  embed itself

**Add (no commercial precedent):**
- Per-embed admin overrides as first-class data attributes

## Sources

- [Borlabs Cookie product page](https://borlabs.io/borlabs-cookie/)
- [Borlabs iframe demo](https://borlabs.io/borlabs-cookie/iframe-demo/)
- [Borlabs shortcodes KB](https://borlabs.io/kb/overview-of-all-shortcodes-and-their-function-for-borlabs-cookie/)
- [Borlabs Cookie config export gist (timohubois)](https://gist.github.com/timohubois/d58d8c11ed671bba07f64d75aa576178)
- [Borlabs Cookie 3.0 announcement](https://borlabs.io/borlabs-cookie-3-0/)
- [Borlabs Cookie service & content blocker templates KB](https://borlabs.io/kb/service-cookie-content-blocker-templates/)
- [Borlabs changelog](https://borlabs.io/borlabs-cookie/changelog/)
- [devowl review of Borlabs](https://devowl.io/2022/borlabs-cookie-review/)

---

# II. Real Cookie Banner — deep dive

## Executive summary

Real Cookie Banner (RCB) by devowl.io is the dominant German-market
WordPress CMP with 100,000+ active installs, 4.9/5 stars / 484 reviews on
wp.org, and a "freemium" model where the free version is unrestricted in
core functionality but the service/content-blocker template library and
the polished Hero placeholder layout are PRO-only. Three findings most
worth stealing:

1. Hero layout + locally downloaded thumbnail is the core UX trick. For
   YouTube the placeholder shows a darkened thumbnail with a **black**
   play button (not YouTube's red, to avoid trademark risk), looking
   nearly indistinguishable from a real embed.
2. Two-blocker-type architecture: "Hero" (visual placeholder that mimics
   the embed) and "Wrapped" (transparent overlay around arbitrary
   content). Per-blocker, not per-instance — but each content blocker
   can be assigned its own layout independently.
3. **The plugin source is fully readable.** Devowl publishes a
   downloadable source ZIP at
   `assets.devowl.io/wordpress-plugins-source-code.zip` and ships JS
   source maps in production — so the entire codebase is forensically
   inspectable. The free version is also browsable via WordPress.org SVN.

## 1. The Hero Visual Content Blocker — exact mechanism

Introduced in RCB 3.0 alongside a second "Wrapped" layout. For YouTube
the placeholder renders a darkened YouTube thumbnail with a black play
button overlay (intentionally black, not YouTube-red). One reviewer's
description: *"Die Hero-Variante sieht fast aus wie ein echtes
YouTube-Video, mit einem Play-Button (allerdings schwarz statt rot) und
einer leicht abgedunkelten Vorschau."*

Click behavior is single-click consent: clicking triggers "consent for
this service" + immediate unblock + auto-play of the original video.
RCB's compare page markets this: *"Auto-Playing Videos Post-Consent —
YouTube, Vimeo, Dailymotion, and Loom."*

Per-service breakdown:

| Service     | Behavior                                                | Confidence |
|-------------|---------------------------------------------------------|------------|
| YouTube     | Hero + darkened thumbnail + black play button. Autoplay | Verified   |
| Vimeo       | Hero layout, autoplay post-consent                      | Verified   |
| Spotify     | Listed template; generic Hero with Spotify-style chrome | Inferred   |
| SoundCloud  | Listed template                                         | Inferred   |
| Google Maps | Listed; click → consent → load static or interactive    | Inferred   |
| Twitter/X   | Template exists                                         | Inferred   |
| Instagram   | "Instagram posts" template                              | Inferred   |
| Facebook    | Template exists                                         | Inferred   |

Thumbnail acquisition: devowl's wording ("download and locally display
the thumbnail") + absence of any documented oEmbed mention suggests the
plugin fetches the thumbnail server-side from YouTube's public CDN
endpoints (e.g. `img.youtube.com/vi/<id>/maxresdefault.jpg`) at
admin-save time, then stores it locally.

## 2. Server-side thumbnail download — implementation

- Admin-toggleable, not always-on. Multiple reviewers describe it as an
  explicit option in the per-content-blocker settings.
- Stored locally on the WP server. Custom upload subdirectory under
  `wp-content/uploads/real-cookie-banner/` (inferred).
- Refresh policy unknown.
- Privacy on fetch: server-side fetch — visitor's IP is never involved.
- Fallback when fetch fails: Hero layout still works without a thumbnail
  (generic dark box with play icon).
- Metadata captured alongside thumbnail: unknown. Placeholder uses
  admin-supplied "Name" + "Description" fields, not metadata pulled from
  YouTube.

## 3. Per-instance customization

Short answer: NO genuine per-instance override. Customization is locked
at the per-content-blocker level. Admin form has four primary fields:
Name, Description, URLs/Elements to block, Connected cookies. Plus
layout selector (Hero/Wrapped/Text-Box) and thumbnail-download toggle.

No Gutenberg block ships with RCB for per-embed overrides. The plugin
relies on rewriting/intercepting WordPress's built-in embed blocks at
render time. The `forceVisual()` JS API and `[data-name=...]` attribute
system are for *forcing* a blocker to appear, not for customizing copy.

**This is a real SimpleCMP differentiator opportunity.** A Gutenberg
block / TYPO3 content element that lets an editor write a custom
title/description for this specific embed is something neither RCB nor
Borlabs offers.

## 4. Library / catalog scale

- Current count (RCB 5.x, May 2026): *"160+ service templates and 130+
  content blocker templates"* on the wp.org listing. Cross-comparison
  page claims *"180+ service templates and 200+ content blocker
  templates"*.
- All templates are PRO-only, except ~10 in the free version.
- Catalog source: vendor-curated. Devowl: *"We invest one to six
  man-hours to research for each service"*. No community PR repo.
- Coverage: all big tech, Meta, Vimeo, Dailymotion, Loom, Spotify,
  SoundCloud, Pinterest, LinkedIn, TikTok, X/Twitter, OpenStreetMap,
  Stripe, Klarna, PayPal, Hotjar, Matomo, Plausible, Mailchimp,
  ActiveCampaign, ConvertKit, Brevo/Sendinblue, Klaviyo, Calendly,
  Intercom, Crisp, Tawk.to, Drift, Zendesk, HubSpot, Salesforce, Pardot,
  WooCommerce extensions, Elementor, Jetpack, Wordfence, Contact Form 7,
  VG Wort, plus 28 CDN-specific recommendations.

## 5. Pricing tiers

Free version (wp.org): all core consent management, content blocker
engine, scanner. ~10 templates included. Unlimited custom services +
blockers.

Pro tiers (annual): Single €59 (1 site), Starter €89 (3), Professional
€129 (5), Business €229 (10), Agency €299 (25). Dev/staging environments
included 1:1 per tier.

The Hero layout itself is available in the free version (it's part of
the content blocker engine, not the templates) — but without curated
templates, admins would manually configure each Hero blocker.

## 6. Open-source status

Not open-source. RCB is GPLv2 for the free version (wp.org requirement),
but the Pro version is proprietary commercial. Source is publicly
readable from two sources:

1. WordPress.org SVN (free version):
   `https://plugins.svn.wordpress.org/real-cookie-banner/`
2. Devowl's own ZIP:
   `https://assets.devowl.io/wordpress-plugins-source-code.zip` — they
   explicitly invite inspection. JS source maps are also hosted publicly.

License implications: readable does NOT mean copyable. Pro features in
the ZIP are commercial-licensed. We can study architecture, naming
conventions, REST API shape — fair-use for compatibility research.

Plugin is built in React (not Lit/Web Components) with modern PHP +
REST API backend.

## 7. Multi-language

Plugin localized in 17–22 EU languages by humans (German formal/informal
both shipped — DACH-market signal). Service template copy is "partly
machine-translated and will be revised by humans in the future."

Translation plugin compatibility: WPML, Polylang, TranslatePress, Weglot.
Broader compatibility than Borlabs (WPML only).

## 8. Compliance angle — out-of-box copy

The Hero placeholder is intentionally minimal: Name + Description +
button. The full compliance text lives one click away. The service
template carries the heavy compliance lifting — recipient legal entity
("Google Ireland Limited, Gordon House, Barrow Street, Dublin 4,
Ireland"), data categories, processing purposes, third-country transfer
notice (USA, with SCCs footnote), privacy policy link. These fields
appear in the cookie banner detailed view, not on the Hero placeholder
itself.

Deliberate UX trade-off: maximize click-through (user sees video-like
card → clicks → consents) at the cost of putting compliance copy behind
one extra interaction.

## 9. RCB vs Borlabs — reviewer consensus

Strong consensus that RCB beats Borlabs:

- Multiple sources cite *"countless templates"* (122 content blockers +
  145 services vs. Borlabs' ~15) as game-changing for agencies.
- Service scanner (automatic sitemap walk) and free version cited as
  decisive.
- wp.org reviews (4.9/5, 484 reviews) praise support response time +
  template breadth.
- Pricing parity close (RCB €59 vs Borlabs €58.31 entry). RCB wins on
  free tier; Borlabs wins on UI polish per some reviewers.

## 10. Surprising / worth-stealing patterns

1. **Black play button** on Hero placeholder — clever trademark
   avoidance.
2. **Service Scanner** — RCB walks the site's sitemap server-side. Same
   concept as our Recorder mode but runs on the server, against the
   production HTML.
3. **Two-tier architecture: Service + Content Blocker as separate
   entities.** Service stores compliance data; Content Blocker stores
   blocking rules + visual layout. Linked many-to-many. Aligns well with
   SimpleCMP's library/registry split.
4. **`forceVisual()` JS API** — forces a visual blocker on hidden
   elements (`display:none` iframes).
5. **Per-blocker layout assignment** — Hero / Wrapped / Text-Box
   selectable per content blocker.
6. **CDN-specific consent recommendations** (28 CDNs catalogued).
7. **Source-maps in production + downloadable source ZIP** as a
   trust-building move.
8. **Sandbox-as-marketing** — `try.devowl.io` spins up a 24-hour
   disposable WordPress instance with RCB preinstalled.
9. **Audited by external law firm** meibers.rechtsanwälte — marketed as
   legal-trust signal.
10. **The "Wrapped" layout** — transparent overlay on top of original
    DOM instead of replacing it. Lighter-weight visually.

## Sources

- [Real Cookie Banner on WordPress.org](https://wordpress.org/plugins/real-cookie-banner/)
- [Real Cookie Banner product page (devowl.io)](https://devowl.io/wordpress-real-cookie-banner/)
- [RCB 3.0 announcement](https://devowl.io/news/real-cookie-banner-3-0/)
- [RCB 2.0 announcement](https://devowl.io/news/real-cookie-banner-2-0/)
- [Devowl Knowledge Base — content blocker creation](https://devowl.io/knowledge-base/real-cookie-banner-create-individual-content-blocker/)
- [Developer API docs](https://devowl.io/wordpress-real-cookie-banner/developer-api/)
- [GDPR-compliant YouTube embedding (devowl)](https://devowl.io/gdpr-compliant/youtube/)
- [WordPress.org SVN](https://plugins.svn.wordpress.org/real-cookie-banner/)
- [Devowl source ZIP](https://assets.devowl.io/wordpress-plugins-source-code.zip)

---

# III. Commercial CMP comparative survey

Scope: eight vendors, focus on the content-blocker placeholder feature
for YouTube / Vimeo / Google Maps and similar third-party embeds.
Borlabs and RCB excluded (covered in Sections I and II).

## 1. Cookiebot (Usercentrics-owned)

Cookiebot ships an opt-in automatic placeholder specifically for YouTube,
Vimeo, and Google Maps iframes. Mechanism: the iframe must be tagged
with `data-cookieconsent="marketing"` and the real URL moved from `src`
to `data-cookieblock-src` (formerly `data-src`). Cookiebot then replaces
the blocked iframe with a generated placeholder that inherits the size
of the original.

**Visual UX: text-only box, no thumbnail.** This is the most striking
gap vs Borlabs/RCB/Complianz — Cookiebot does not auto-fetch or display
the YouTube thumbnail. Default copy is generic "this content is blocked
because you did not accept the marketing category" with an inline
"update consent settings" link that reopens the modal.

Per-service customization: yes, via admin (category-level copy).
**Per-embed customization: no** — every blocked YouTube on a site looks
identical.

DSGVO copy out-of-box: weak. References generic *category*
("marketing"), not the named recipient, data categories, or third-country
flag.

Pricing: freemium. Free = 1 domain / 50 subpages; paid from €7-30/mo,
auto-upgrades based on scan results. Closed-source SaaS.

- [Cookiebot automatic placeholders KB](https://support.cookiebot.com/hc/en-us/articles/5517378002844-Automatic-placeholders-for-Google-Maps-Vimeo-and-YouTube)

## 2. Usercentrics CMP

Smart Data Protector (SDP) — promises automatic blocking + a preview-
image placeholder for services with visual representation. Real
implementation is less developed than marketing implies. The MIT-licensed
community add-on `netresearch/usercentrics-widgets` is the de-facto
reference: developers wire overlays manually using `UC_UI.acceptService(id)`.

Visual UX (inferred from netresearch widget): full-bleed overlay over
the iframe area with service name, explainer sentence, "Accept" button.
No auto-thumbnail. The netresearch library supports
`data-uc-background-image` per element — meaning per-instance backgrounds
are possible if the website operator uses the community widget.

Per-service vs per-instance: vendor primitive is per-service. Community
widget extends to per-instance via data attributes.

Click-to-accept-just-this-service: yes via `UC_UI.acceptService(id)` —
but the host site has to wire this.

DSGVO copy out-of-box: pulled from central service template (named
recipient, data categories, retention, third-country). Placeholder only
shows service name + generic message; full legal text in the modal.

Pricing: enterprise SaaS, opaque. netresearch widget is MIT and the
only readable source code.

- [Smart Data Protector – Usercentrics](https://usercentrics.com/smart-data-protector/)
- [netresearch/usercentrics-widgets (GitHub)](https://github.com/netresearch/usercentrics-widgets)

## 3. Complianz (WordPress, Dutch origin)

The most polished thumbnail-based placeholder of any vendor surveyed —
closer to Borlabs/RCB than anyone else here. For YouTube, Vimeo,
Dailymotion, the plugin server-side downloads the thumbnail at first
request and stores it in `wp-content/uploads/`, then serves as the
placeholder background. Clickable "Accept" button overlay opens consent
for that service.

Per-service customization: yes, via filters (`cmplz_placeholder_default`,
`cmplz_placeholder_youtube`, `cmplz_placeholder_google-maps`, etc.).
Custom images can be dropped into `themes/<theme>/complianz-gdpr/` for
non-developer overrides.

Per-instance customization: **no** — same gap.

Auto-fetch copyright stance: Complianz publishes a public "fair use"
argument for thumbnail caching (non-commercial purpose, screenshot only,
no market harm). They expose an off switch under
`Complianz → Integrations → Services → YouTube`.

Pricing: freemium WordPress plugin. Thumbnail-placeholder feature
present in free version since 5.5. Pro adds geo-targeting, A/B,
cookie-policy generator. **GPL-2 source.**

- [Customize service placeholders – Complianz](https://complianz.io/customize-service-placeholders/)
- [YouTube placeholders – Copyright on thumbnails](https://complianz.io/youtube-placeholders-copyright-on-thumbnails/)

## 4. CCM19 (Papoo / Germany)

The closest direct competitor to Borlabs in the DACH market. Like
Complianz, **CCM19 auto-fetches and displays YouTube/Vimeo screenshots**
as the placeholder image (docs state: "screenshots of the videos are
displayed on the page as a blocking image").

Mechanism: hybrid. Either (a) URL-pattern filters auto-rewrite matching
`<iframe>` tags, or (b) explicit per-element markup using
`data-ccm-loader-src` + `data-ccm-loader-group`. Lets non-technical
operators rely on URL filter while developers retain explicit control.

Customization: per-service plus a per-iframe **toggle switch** that
admins can opt into — once enabled, a small switch is rendered alongside
the placeholder allowing the visitor to enable/disable just that one
piece of content. **Closest thing to per-instance UX** of any reviewed
vendor, even though customization itself is still per-service.

"Remember consent per domain": after first acceptance, all further
YouTube embeds on the same domain auto-load. Borderline as a
transparency choice.

DSGVO copy: admin-editable. Defaults minimal ("Click here to load
YouTube content") and do **not** name the recipient legal entity or
third-country status on the placeholder.

Pricing: paid-only. Starter ~€9/mo cloud, self-hosted PHP license from
~€499 one-time. Closed-source, but self-hostable.

- [Iframe blocker from CCM19](https://www.ccm19.de/en/iframe-blocker.html)

## 5. Cookie Information (Danish)

The most minimal placeholder of the surveyed vendors — text-only with
inline "renew" link. Mechanism: `<div class="consent-placeholder"
data-category="cookie_cat_marketing">` rendered into the markup by the
host, with `onClick="CookieConsent.renew()"` reopening the modal.

Visual UX: text box, no thumbnail, no service-specific theming. Looks
identical for everything; distinguishes only by `data-category`.

Per-service vs per-instance: technically per-instance because the host
writes each placeholder div manually — but no admin UI for it.

Click-to-accept-just-this-service: no. `CookieConsent.renew()` opens
the full modal.

Pricing: enterprise SaaS, no public free tier. Closed source.

- [Provide placeholder for blocked page elements – Cookie Information](https://support.cookieinformation.com/en/articles/4418529-provide-placeholder-for-blocked-page-elements-youtube-vimeo-etc)

## 6. OneTrust

**Does not ship per-embed placeholders out of the box.** Official
developer documentation: *"By default, blocking a YouTube video introduces
a large white space that remains unfilled until the category associated
with the YouTube cookies has been enabled."*

What they provide is a recipe for building one yourself: sample HTML
snippet using class-based conditional visibility
(`optanon-category-C0004`) and custom `enableTargeting()` JS calling
`OneTrust.UpdateConsent()`. Everything else is on the customer's web team.

Consistent with positioning: enterprise compliance suite, customers
typically Fortune-500 with in-house dev teams, optimized for breadth
(TCF, MSPA, IAB Global Privacy Platform, etc.).

The most expensive vendor delivers the least placeholder UX.

- [Custom Common HTML – OneTrust Developer](https://developer.onetrust.com/onetrust/docs/custom-common-html)

## 7. iubenda (Italian)

Uses a `class="_iub_cs_prompt" data-iub-purposes="x"` attribute pair.
Per-element: host wraps any element they want gated, sets the purpose
ID. `promptToAcceptOnBlockedElements` config toggles whether the prompt
appears.

Visual UX: dialog box overlay, not a thumbnail surrogate. Default copy
is well-templated with i18n placeholder interpolation:

> Title: "Content is blocked"
> Body: "You denied the use of cookies or similar technologies for
> %{purposes}. To view this content, please update your consent
> preferences"
> Button: "Update"

`%{purposes}` interpolation automatically names the relevant purposes
from the central vendor list — a small but real DSGVO improvement over
Cookiebot/Cookie Information. No auto-thumbnail.

Per-service vs per-instance: per-instance via per-element data
attribute, but visual template is shared.

Click-to-accept-just-this-service: "Update" opens consent preferences
(the modal). No one-click direct activation.

Pricing: placeholder feature requires Ultimate plan (~€27/mo).
Closed source.

- [How to display a notice in place of pre-blocked scripts – iubenda](https://www.iubenda.com/en/help/104812-how-to-display-a-notice-in-place-of-pre-blocked-scripts/)

## 8. CookieYes

Auto-blocking driven by domain scan (similar to Cookiebot). Iframe-
specific placeholder UX is the weakest of any vendor reviewed.

Documentation centers on script blocking and barely addresses iframes.
WordPress.org support threads from 2024-2026 surface a recurring
complaint: **"Huge space before the blocked content (YouTube, Spotify
player, etc.)"** — blocked iframes are removed/hidden but no surrogate
UI is rendered in their place.

Visual UX: effectively no placeholder by default.

Pricing: freemium. Free with up to 5000 pageviews/month + mandatory
CookieYes branding. Paid from $10/mo. Closed-source SaaS.

- [How to Implement Prior Consent and Cookie Auto-Blocking - CookieYes](https://www.cookieyes.com/documentation/implement-prior-consent-using-cookieyes/)

## Synthesis (commercial)

**Materially different from Borlabs/RCB:**
- Complianz: same league as Borlabs/RCB — auto-thumbnails, filters,
  off-switch, public fair-use defence. Same per-instance gap.
- CCM19: closest to per-instance UX primitive (per-iframe toggle switch).
- Usercentrics: only via community widget (`netresearch/usercentrics-
  widgets`, MIT) — `data-uc-background-image` per element. Real
  implementation reference.
- OneTrust: contrarian — ships nothing. "No opinionated default" is a
  viable position when buyer has in-house dev capacity.

**Same minimal pattern** (text box, generic copy, "open the modal" CTA,
no thumbnail): Cookiebot, Cookie Information, iubenda, CookieYes.

**Patterns worth stealing:**
1. Per-instance background image as data attribute on the embed
   (netresearch widget).
2. Per-iframe toggle switch (CCM19) — small UI affordance for
   per-instance enable/disable.
3. Purpose-interpolated default copy (iubenda's `%{purposes}` template).
4. Server-side thumbnail cache + public fair-use defence + off switch
   (Complianz).

**DSGVO copy out-of-box (named recipient, data categories, third
country, privacy policy link):** None of the eight ships fully-compliant
defaults. Every vendor defers full legal disclosure to the central
declaration / modal. **Open lane.**

**Per-instance customization:** confirmed gap. Nobody ships a
first-class admin UI for per-instance copy/image.

**Documented UX criticism:** 2026 paper *"When the Abyss Looks Back:
Unveiling Evolving Dark Patterns in Cookie Consent Banners"*
([arxiv 2603.21515](https://arxiv.org/html/2603.21515v1)) catalogues
"consent revocation barriers" and "fake opt-outs" as evolved dark
patterns (DP11-DP19). Implicit pitfalls:

- "Update" / "Renew" CTAs that open the modal instead of activating just
  the matched service (Cookie Information, iubenda, Cookiebot) — soft
  dark pattern.
- "Remember consent per domain" auto-enabling all future embeds (CCM19)
  — UX wins, borderline on transparency.

Both easy to get right by making the placeholder CTA a true one-click
`acceptService(service)` and recording consent at service granularity.

---

# IV. Open-source CMP landscape

## 1. Klaro! upstream (KIProtect/klaro)

**Barely alive.** Latest tag still `v0.7.22` (March 26, 2024) — the same
version we forked from. No 0.8.x / 0.9.x line. Last commit to `master`
March 27, 2025. 1.5k stars, 293 forks, 149 open issues, 21 open PRs.
Heavy issue backlog suggests maintenance-mode.

License: BSD-3-Clause (matches our LICENSE-KLARO).
Governance: Single-org (KIProtect, Berlin). Slow issue triage.

Klaro calls the contextual notice **"Contextual Consent"**. Mechanism
per [klaro.org/docs/tutorials/contextual_consent](https://klaro.org/docs/tutorials/contextual_consent):

- Replace `src` with `data-src`, add `data-name="<service-id>"` to the
  element (works on `<iframe>`, `<div>`, `<script>`).
- Service-level flag `contextualConsentOnly: true` makes a service only
  consentable via the placeholder (excluded from blanket Accept-All).
- Per-service title/description from service config; per-instance
  customization not documented.
- Known limitation: GitHub issue
  [#361](https://github.com/KIProtect/klaro/issues/361) — "No placeholder
  for external content at first pageload" remains open. Placeholder
  renders only after Klaro init runs, so a SSR-rendered embed flashes
  briefly. **Check whether our Phase-2 head-priority blocking mitigates
  this.**

No bundled service registry — Klaro ships with none. This is the gap
SimpleCMP fills with `simplecmp/services-library`.

What we can borrow: confirms our markup choice (`data-name` + `data-src`)
is the de-facto open-source convention.

## 2. tarteaucitron.js (AmauriC/tarteaucitron.js)

Very active. Latest release v1.32.0 on April 7, 2026; 50 total releases;
1,520+ commits. ~1.0k stars (metric understates adoption — heavily used
via copy-paste rather than npm).

License: MIT. Single-maintainer (Amauri, France).

Per-service `fallback` property + `tarteaucitron.fallback()` helper. For
embedded media, replaces embed with styled box including service name,
"Allow YouTube" button, explanatory message. Per-instance customization
via `tarteaucitronCustomText` override — no first-class per-instance
dataset API.

Per-service catalog: file
[tarteaucitron.services.js](https://github.com/AmauriC/tarteaucitron.js/blob/master/tarteaucitron.services.js)
— ~7,264 lines, ~200+ services. Categories: ads, analytic, api, comment,
social, video, support, etc. Each service is a JS object with `key`,
`type`, `name`, `uri`, `needConsent`, `cookies`, `js: function()`,
optional `fallback: function()`. **Stored as a single monolithic JS
file.** Maintainability liability but works because new services are
appended by community PR.

Multi-language: **43 language files** in `/lang/` — vastly more than
Klaro (~10) or our 12-pack.

Uniquely well: the community-maintained service catalog. tarteaucitron
is THE open-source competitor to simplecmp/services-library in catalog
scope. ~2-3× the entries we curate (369), but JS code+config tangled —
not portable to other CMPs without a transform. **They have breadth
where we have depth.**

What we can borrow:
- Fallback-as-callback pattern lets each service ship its own placeholder
  rendering.
- The breadth of their service list is a real benchmark — worth
  periodically diffing.

## 3. orestbida/cookieconsent + IframeManager

**cookieconsent v3.1.0 (Feb 2025):** 5.5k stars, MIT, active. Pure banner
+ script-blocking via `type="text/plain"` + `data-category`. No built-in
placeholder UI for embeds. Maintainer punted to:

**[orestbida/iframemanager](https://github.com/orestbida/iframemanager)
— 312 stars, MIT, v1.3.0 (Sep 2024).** The more interesting find:

- Standalone, not coupled to cookieconsent.
- Services configured via central object with: `embedUrl` (template like
  `https://www.youtube.com/embed/{data-id}`), `thumbnailUrl` (function
  or pattern, supports API-fetched), `iframe` props, `cookie` settings,
  `languages` block (per-language notice text + button labels),
  `onAccept` / `onReject` hooks.
- Placeholder DOM: cloneable element with `[data-placeholder]`.
  Pre-rendered classes: `c-tl` (title), `c-t-cn` (notice), `c-bg`
  (background thumbnail), `c-ld` (loading). Two buttons: "Load this
  iframe" + "Load all instances".
- **Per-iframe customization via `data-iframe-*` attributes** — any
  attribute prefixed `data-iframe-foo="bar"` is mapped onto the
  resulting iframe's `foo="bar"`. More elegant than what we do.
- Thumbnail auto-fetch hooks exist.

Languages: in-config (per service), not separate files. ~10 commonly in
demos.

**What we can borrow (high-priority):**
- `data-iframe-*` attribute pattern for forwarding arbitrary attributes
  onto the lazy-loaded iframe.
- `{data-id}` URL templating inside service config — simpler than
  building URLs in callbacks.
- Cloneable `[data-placeholder]` DOM scaffolding lets integrators
  *replace* the placeholder template entirely without forking.

## 4. Cookie Notice — dFactory

63 stars, mirror of WP plugin. Just a notice banner with accept/reject
UI and `cn_cookies_accepted()` PHP helper. **No embed-blocking, no
placeholders.** Effectively legacy.

## 5. Other GitHub-discoverable open-source CMPs

- **[fabiodalez-dev/FAZ-Cookie-Manager](https://github.com/fabiodalez-dev/FAZ-Cookie-Manager)**
  — 109 stars, GPL-3.0, v1.16.2 (May 2026), 52 releases. 11 languages
  + 180+ admin-selectable. Uses Open Cookie Database (2,200+
  definitions) for auto-categorization. Has YouTube/Vimeo embed
  placeholder. **GPL-3.0 incompatible** for BSD-3-Clause absorption.
- **[osano/cookieconsent](https://github.com/osano/cookieconsent)** —
  3.5k stars, MIT, v4.0. Pure banner + script-blocking; no placeholder.
- **[silktide/consent-manager](https://github.com/silktide/consent-manager)** —
  112 stars, MIT. Banner-focused.
- **[empreinte-digitale/orejime](https://github.com/empreinte-digitale/orejime)** —
  188 stars, BSD-3-Clause, 547 commits, 28 tags. **Klaro fork that
  diverged.** Contextual consent via `data-contextual` template attribute.
  Multi-language: 14 languages bundled. Accessibility-focused tagline:
  "lightweight consent manager that focuses on accessibility". Worth an
  a11y audit comparison.
- **[brainsum/cookieconsent](https://github.com/brainsum/cookieconsent)** —
  Drupal-org-aligned fork. Banner-focused.
- **[68publishers/cookie-consent](https://github.com/68publishers/cookie-consent)** —
  GTM/GCM-integrated.
- **[ryze-digital/cookie-consent](https://github.com/ryze-digital/cookie-consent)** —
  abstraction layer over Cookiebot/Usercentrics/OneTrust.

## 6. Embed Privacy (epiphyt/embed-privacy) — the dark horse

Not on the original list but the most direct competitor in WordPress:

- **10,000+ active installs** on WordPress.org, GPL-2+. 4.9-star rating,
  last update May 12, 2026. Actively maintained by Epiphyt (southern
  Germany — same DACH market).
- Replaces every WordPress oEmbed with a placeholder by default.
  Supported providers: Amazon Kindle, Anghami, Animoto, Bluesky, Canva,
  Cloudup, DailyMotion, Facebook, Flickr, Funny Or Die, Imgur,
  Instagram, Issuu, Kickstarter, Meetup, Mixcloud, Photobucket, Pocket
  Casts, Polldaddy, Reddit, ReverbNation, Scribd, Sketchfab, SlideShare,
  SmugMug, SoundCloud, Speaker Deck, Spotify, TikTok, TED, Tumblr,
  Twitter/X, VideoPress, Vimeo, WordPress.org, WordPress.tv, YouTube,
  plus Google Maps via iframe, plus Divi/Jetpack/Maps Marker.
- **Admin UI to manage embeds**: per-service overlay text, logo,
  background image, enable/disable.
- **Auto-downloads thumbnails** for YouTube, Vimeo, SlideShare since
  v1.5.0 — exactly the deferred feature in
  `contextual_notice_customization.md`.
- Languages: 6 (Albanian, Asturian, English, German, Spanish (CL),
  Spanish (ES), Swedish).
- Opt-out shortcode `[embed_privacy_opt_out]` for global opt-out
  controls in privacy-policy page.
- GPL-2+ — incompatible to absorb directly, but architectural blueprint
  is the most directly comparable to what SimpleCMP+TYPO3 is building.

## 7. Plausible Analytics — design-point reference

Not a CMP. Position: "By not using cookies, you do not need to obtain
consent from visitors. No cookie banner required." References an
independent legal assessment (German DPA-aligned).

**Recommendation:** worth a short "Pre-consent analytics that don't
trigger our banner" section in README/CONTRIBUTING. Documenting that a
well-configured Plausible/Matomo (anonymized IP, no cookies, no Tag
Manager) usually doesn't need the SimpleCMP banner reduces friction for
new site-owners. Positioning, not a code feature.

## Synthesis (open-source)

**The strongest open-source competitor for SimpleCMP overall is
tarteaucitron.js**, on the strength of its service catalog and
43-language coverage. But monolithic JS-with-config — they don't have
the queryable registry, bridge webhook, recorder, or four-state BE model.

**The strongest open-source competitor specifically on contextual-notice
mechanics is the orestbida ecosystem (cookieconsent + iframemanager)**.
Three patterns to consider:

1. `data-iframe-*` attribute forwarding.
2. URL templating in service config: `embedUrl:
   "https://youtube.com/embed/{data-id}"`.
3. Cloneable `[data-placeholder]` DOM as template override.

**The most direct WordPress-ecosystem competitor is
epiphyt/embed-privacy** (10k installs, German market, auto-thumbnails,
per-service admin UI). When SimpleCMP ships a WordPress plugin, this is
the project to study and feature-match. Their auto-thumbnail download
already implements the deferred feature in our
`contextual_notice_customization` memory.

**On Klaro upstream:** there is no 0.8.x. We forked from the high-water
mark. Our divergence is real and not catchable by Klaro in its current
state. Two open Klaro issues to watch: #361 (no placeholder at first
pageload — relevant for SSR) and #400 (deactivate contextual consent
placeholders — feature flag for integrators).

**Orejime's accessibility positioning** is the one differentiator we
don't currently advertise. We may already exceed their bar with Lit/
shadow-DOM but don't claim it.

---

# V. DACH legal landscape

Scope: what the placeholder UI must legally say after a visitor has
refused consent (or before granting it), in DE/AT/CH.

## 1. Hard requirements

**TDDDG § 25 Abs. 1** (formerly TTDSG; URL stays
`gesetze-im-internet.de/ttdsg/__25.html`): storing information on, or
accessing information from, the visitor's terminal is only permitted
with consent on the basis of "clear and comprehensive information"
(`klare und umfassende Informationen`). Technology-neutral; covers any
iframe that drops cookies / localStorage / fingerprint reads.

**DSGVO Art. 13** (data collected from the data subject): before
processing starts, the controller must disclose **(a)** identity +
contact of the controller, **(b)** purposes + legal basis, **(c)**
recipients or categories of recipients, **(d)** third-country transfer
+ reference to the safeguard (adequacy decision / SCCs / link to copy),
**(e)** storage period, **(f)** rights including withdrawal.

**EuGH Fashion ID (C-40/17, 29.07.2019):** the embedding site is **joint
controller** with the third party for the collection and onward
transmission triggered by the embed; consent must be obtained by the
embedding site, not by the third party. The site cannot defer Art. 13
disclosure to YouTube's own privacy policy.

**EuGH Planet49 (C-673/17, 01.10.2019):** consent must be active,
specific to the purpose, and informed **before** the action. Applied to
placeholders, the visitor must see the disclosure before the click.

**Strong recommendation (DSK Orientierungshilfe Telemedien v1.1,
20.12.2021):** the disclosure surface must be on the **same layer** as
the action — i.e. the placeholder needs the disclosure inline, not
behind a "more info" link. Same-layer "reject as prominent as accept"
rule carries over to per-service placeholders.

**TMG no longer in force** for this question — superseded by Digitale-
Dienste-Gesetz (DDG) on 14.05.2024; data-protection chunks live in
TDDDG.

## 2. DSK guidance on placeholders

Orientierungshilfe für Anbieter:innen von Telemedien (OH Telemedien
2021, v1.1) — central document. On placeholders, OH does not have a
dedicated section titled "Platzhalter," but general principles bind:

- Consent must be granular per purpose / per service; a single bulk
  "Accept all third-party content" does not satisfy specificity.
- Disclosure must name the recipient, the purpose, and the third-country
  transfer at the moment of the consent action.
- Reject must be equally easy as accept on the same level — implication:
  visible way to not enable the embed without leaving the page (the
  placeholder's existence satisfies this — visitor can simply not click).
- Withdrawal must be reachable without burying it in a privacy policy.

## 3. Case law and DPA decisions

- **LG München I, 20.01.2022, Az. 3 O 17493/20** (Google Fonts dynamic
  embedding): transmitting visitor IP to a US Google service without
  consent violates Art. 6(1) DSGVO; awarded €100 immaterial damages
  under Art. 82. The "dynamic IP = personal data" holding generalizes
  to every dynamically loaded asset (YouTube poster image, Vimeo
  `vimeocdn.com` request, etc.).
- **VG Wiesbaden, 01.12.2021, Az. 6 L 738/21.WI** (Cookiebot via Akamai
  US): even the CMP itself was held to be impermissibly transmitting IP
  to a US CDN. **Direct read-across to pre-consent thumbnail fetching
  from a US CDN: client-side fetch leaks IP and is unlawful absent
  consent.**
- **DSB Österreich, Bescheid noyb v. Google (YouTube), 2025**: YouTube
  confirmed as controller; processes IP, cookie IDs, Facebook-Pixel-
  equivalent identifiers, viewing behavior. Locks down what data
  categories the embedding site has to disclose: at minimum IP, device
  identifiers, viewing/interaction behavior, plus any cookies-on-the-
  Google-domain.
- **EuGH Fashion ID** — already cited.
- **OLG Köln, 19.01.2024, Az. 6 U 80/23** + **VG Hannover, 19.03.2025** —
  banner button-equivalence. Applies per-analogy to placeholders ("Video
  laden" must not be visually privileged over a "Nein" option).

Switzerland: no published EDÖB decision specifically on embed
placeholders. Generic FADP / revDSG rules apply.

## 4. Schrems II / third-country transfer

**EU-US Data Privacy Framework adequacy decision in force since
10.07.2023.** US recipients that are DPF-certified ride on an adequacy
decision (Art. 45 DSGVO). The placeholder still needs to disclose the
transfer but no longer has to wave the "no equivalent protection" red
flag if the recipient is certified.

DPF status of relevant services (verify before shipping):
- Google LLC (YouTube, Google Maps) — certified
- Meta Platforms Inc. (Facebook, Instagram) — certified
- X Corp. — **not** DPF-certified; transfer rests on SCCs +
  supplementary measures. **Higher disclosure burden.**
- Vimeo Inc. — DPF-certified
- Spotify AB — Swedish entity, primary processing in EU; further
  transfers under SCCs

Minimum required disclosure when US recipient is involved:

> Beim Aktivieren werden Daten an [Anbieter, US-Konzern] in den USA
> übertragen. Für diese Übermittlung gilt der EU-US Data Privacy
> Framework / die Standardvertragsklauseln nach Art. 46 DSGVO.

DSK requires the safeguard to be named, not just alluded to.

## 5. noyb campaigns

**noyb Cookie Banner Report, July 2024**: catalogues which dark patterns
trip national DPAs. Explicit position: reject must match accept in
visibility on the same layer. No dedicated rule for placeholders, but
commentary treats per-service consent as the correct implementation of
specificity — noyb supports the placeholder architecture; what they
attack is placeholders that misrepresent the cost.

Equivalent-prominence rule on placeholders: no published noyb position
saying "the 'No' must be a button the same size as 'Yes' inside the
placeholder." **Inferring from general posture:** putting the recipient
name + data categories visibly above a single "Video laden" button is
enough — the absence of a click is the rejection.

## 6. Two-step consent — actual rule or best practice?

No statute saying the visitor must see a confirmation dialog after
clicking the placeholder. The placeholder copy itself is the disclosure
surface; the click is the consent act. **One step is legally sufficient**
if the placeholder shows recipient, purpose, data categories, and
third-country status before the click.

The "Two-Click-Lösung / Shariff" pattern (c't 2014–2018): click 1 =
unblock the social button locally, click 2 = the action itself. Predates
DSGVO. Under DSGVO + Planet49 a single informed click on the placeholder
satisfies the consent requirement, provided disclosure is present before
the click.

**Conclusion: one-step is the legal floor. No confirmation modal
needed.**

## 7. Required data-recipient disclosure

DSGVO Art. 13(1)(e): "Empfänger oder Kategorien von Empfängern" —
recipient *or* categories. Categories explicitly permitted (DSK +
Bitkom-Leitfaden 2019 + IHK München Muster). Practical minimum:

- **"Google Ireland Limited"** (not just "Google") because the EU
  controller for YouTube/Maps is the Irish entity.
- The full postal address ("Gordon House, Barrow Street, Dublin 4,
  Ireland") is *not* required on the placeholder itself — belongs in
  the linked privacy policy.

So: **"Google Ireland Limited (YouTube)"** with a link to the full
notice = sufficient.

For US-only controllers (X Corp.): name the US entity and the country.

## 8. Required data-categories disclosure

"Personenbezogene Daten" alone is **insufficient** under Art. 13(1) —
OH Telemedien and noyb-Google DSB decision treat generic phrasing as a
transparency violation. Minimum granularity for video embeds:

- IP-Adresse
- Geräte- und Browserinformationen (User-Agent, Bildschirmgröße)
- Cookie-IDs / lokale Speicher-IDs
- Interaktionsdaten (welches Video, Abspielzeit, Klicks)
- bei eingeloggten Google/Meta-Konten: Account-Verknüpfung

A list of four to five concrete categories on the placeholder is what
DSK + DSB-AT collectively want.

## 9. Server-side thumbnail fetching — consent issue?

**Privacy side:** if your TYPO3 / WordPress backend fetches
`i.ytimg.com/vi/<id>/hqdefault.jpg` from the server, visitor's IP is
**not** transmitted to Google. The fetch carries the server's egress IP.

- No § 25 TDDDG event (no terminal storage / access)
- No Art. 6 DSGVO event regarding the visitor
- No third-country transfer requiring Art. 13(1)(f) for that fetch

The placeholder rendered to the visitor still needs the full Art. 13
disclosure for the click. The server-side prefetch keeps the
pre-consent state clean. **This is the safer architecture; SimpleCMP
should default to it.**

**Copyright side (the harder question):**
- § 44a UrhG cache privilege only covers transient technical
  reproductions; probably does not cover a server-side persistent cache.
- YouTube's Terms of Service grant embed rights; `i.ytimg.com` URLs
  publicly served as part of the embed ecosystem. Dominant view:
  referencing thumbnails by URL is fine (hotlinking); embedding via the
  official iframe mechanism — including its thumbnail surface — is
  licensed.
- **Caching the JPEG locally on your own server** is a separate, riskier
  act. BGH "Vorschaubilder I/II/III" line (Google Bildersuche) found
  search-discoverable surface implies a license — but search-engine-
  specific, doesn't cleanly extend to CMS rehosting.

**Pragmatic default:** hotlink the thumbnail (`<img
src="https://i.ytimg.com/...">`) has the same privacy properties as not
displaying — visitor's browser doesn't reach `i.ytimg.com` until you
load the placeholder *after* consent.

**Better default:** generic neutral placeholder image (gray box with
play icon) and only fetch the real thumbnail when admin explicitly opts
in. Avoids both the copyright question and the IP-leak question.

## 10. DACH-specific quirks

- **Austria (DSG):** § 1 DSG enshrines data protection as a
  constitutional right; lower bar for immaterial damages under Art. 82.
  DSB has actively pursued embed-style cases (Google Analytics 2022,
  DSB-D213.679). **Same legal substance as Germany.**
- **Switzerland (revDSG, in force 01.09.2023):** Art. 19 revDSG =
  transparency at collection; Art. 16/17 = third-country transfer with
  EDÖB-recognised safeguards. EDÖB has recognised EU SCCs; Swiss-US DPF
  mirrors EU one. Most Swiss sites cite both Swiss and EU bases.
- **Austria NIS-2 (NISG 2024):** sector-security law, not data-protection;
  no direct effect on placeholder copy.
- **§ 1 UWG / Wettbewerbsrecht:** German competitors can issue
  *Abmahnungen* for missing Art. 13 disclosures (Google Fonts
  mass-Abmahnung wave 2022 was UWG-based). **Placeholder copy is also
  UWG-relevant; sloppy copy = competitor risk, not just DPA risk.**

---

## SimpleCMP DSGVO-default placeholder copy — German

Format: short headline, three info lines (recipient / categories /
third country + safeguard), then the action. All wording assumes DPF
certification as of 2026-05-27; X Corp. needs the SCC variant.

### YouTube

> **YouTube-Video laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **YouTube**
> (Google Ireland Limited, Dublin) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an Google übertragen. Sind Sie
> bei Google eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Die Übermittlung umfasst eine Verarbeitung in den **USA** (Google
> LLC) auf Basis des **EU-US Data Privacy Framework**
> (Angemessenheitsbeschluss Art. 45 DSGVO).
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

### Vimeo

> **Vimeo-Video laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **Vimeo Inc.**
> geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an Vimeo übertragen. Sind Sie
> bei Vimeo eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Die Übermittlung umfasst eine Verarbeitung in den **USA** auf Basis
> des **EU-US Data Privacy Framework** (Angemessenheitsbeschluss
> Art. 45 DSGVO).
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

### Spotify

> **Spotify-Inhalt laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **Spotify AB**
> (Stockholm, Schweden) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an Spotify übertragen. Sind Sie
> bei Spotify eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Eine Weiterleitung an US-Konzerngesellschaften erfolgt auf Basis der
> **Standardvertragsklauseln nach Art. 46 DSGVO**.
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

### Google Maps

> **Karte laden**
> Mit dem Klick willigen Sie ein, dass diese Karte von **Google Maps**
> (Google Ireland Limited, Dublin) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Standort- und Interaktionsdaten** an Google
> übertragen. Sind Sie bei Google eingeloggt, kann der Aufruf Ihrem
> Konto zugeordnet werden.
> Die Übermittlung umfasst eine Verarbeitung in den **USA** (Google
> LLC) auf Basis des **EU-US Data Privacy Framework**
> (Angemessenheitsbeschluss Art. 45 DSGVO).
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

### Twitter / X

> **X-Inhalt (Tweet) laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **X Corp.**
> (San Francisco, USA) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an X übertragen. Sind Sie bei X
> eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Die Übermittlung erfolgt in die **USA** auf Basis der
> **Standardvertragsklauseln nach Art. 46 DSGVO**. In den USA besteht
> kein dem EU-Recht gleichwertiges Datenschutzniveau; behördliche
> Zugriffe sind nicht ausgeschlossen.
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

(X gets the "no equivalent protection" warning because it is not
DPF-listed — confirm before shipping.)

### Facebook

> **Facebook-Inhalt laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **Meta
> Platforms Ireland Limited** (Dublin) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an Meta übertragen. Sind Sie bei
> Facebook eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Die Übermittlung umfasst eine Verarbeitung in den **USA** (Meta
> Platforms Inc.) auf Basis des **EU-US Data Privacy Framework**
> (Angemessenheitsbeschluss Art. 45 DSGVO).
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

### Instagram

> **Instagram-Inhalt laden**
> Mit dem Klick willigen Sie ein, dass dieser Inhalt von **Meta
> Platforms Ireland Limited** (Dublin) geladen wird.
> Dabei werden Ihre **IP-Adresse, Browser- und Geräteinformationen,
> Cookie-IDs sowie Interaktionsdaten** an Meta übertragen. Sind Sie bei
> Instagram eingeloggt, kann der Aufruf Ihrem Konto zugeordnet werden.
> Die Übermittlung umfasst eine Verarbeitung in den **USA** (Meta
> Platforms Inc.) auf Basis des **EU-US Data Privacy Framework**
> (Angemessenheitsbeschluss Art. 45 DSGVO).
> Ihre Einwilligung können Sie jederzeit über die Cookie-Einstellungen
> widerrufen.

## Suggested library schema extension

```json
{
  "id": "youtube",
  "controller_eu": "Google Ireland Limited, Dublin",
  "controller_us": "Google LLC",
  "data_categories_de": [
    "IP-Adresse",
    "Browser-/Geräteinformationen",
    "Cookie-IDs",
    "Interaktionsdaten",
    "Account-Verknüpfung bei Login"
  ],
  "third_country": "US",
  "transfer_basis": "EU-US-DPF",
  "notice_de": "<full paragraph above>",
  "notice_en": "<English mirror>"
}
```

Placeholder rendering layer can choose long-form paragraph or compact
three-line summary, depending on operator's space. **Full paragraph
above is the legal minimum default;** operators can shorten only if they
keep the four required disclosures (recipient, data categories, third
country + safeguard, withdrawal route).

## Caveats / still uncertain

- **DPF stability:** Schrems-III challenge pending at EuGH. Architect
  the placeholder so the third-country-clause text is a per-service
  field, not hard-coded — when DPF gets struck down, flip the field to
  SCC + "no equivalent protection" wording.
- **X Corp. DPF status:** verify against live DPF list before shipping.
  Same for any service added later.
- **noyb position on placeholder button equivalence:** no specific
  published rule; inferred.
- **Server-side thumbnail caching copyright:** literature split. Default
  to hotlink + neutral fallback.
- **OH Telemedien v1.1** is from 20.12.2021 — a new version may land in
  2026; check `datenschutzkonferenz-online.de/orientierungshilfen.html`
  periodically.

## Key legal sources

- TDDDG § 25: `gesetze-im-internet.de/ttdsg/__25.html`
- DSGVO Art. 13: `dejure.org/gesetze/DSGVO/13.html`
- OH Telemedien 2021 v1.1:
  `datenschutzkonferenz-online.de/media/oh/20211220_oh_telemedien.pdf`
- EuGH Fashion ID C-40/17:
  `eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:62017CJ0040`
- EuGH Planet49 C-673/17
- LG München I 20.01.2022 — 3 O 17493/20:
  `rewis.io/urteile/urteil/lhm-20-01-2022-3-o-1749320/`
- VG Wiesbaden 01.12.2021 — 6 L 738/21.WI
- DSB-AT YouTube Bescheid 2025:
  `noyb.eu/sites/default/files/2025-08/DSB_Entscheidung_YouTube_geschwärzt.pdf`
- DSB-AT Google Analytics:
  `noyb.eu/sites/default/files/2022-01/E-DSB%20-%20Google%20Analytics_DE_bk_0.pdf`
- noyb Cookie Report 2024:
  `noyb.eu/sites/default/files/2024-07/noyb_Cookie_Report_2024.pdf`
- EU-US DPF Angemessenheitsbeschluss:
  `bfdi.bund.de/SharedDocs/Kurzmeldungen/DE/2023/17_Angemessenheitsbeschluss-EU-US-DPF.html`
- OLG Köln 19.01.2024 — 6 U 80/23
- EDÖB Leitfaden Drittland:
  `edoeb.admin.ch/de/bekanntgabe-von-personendaten-ins-ausland`
- Shariff / Two-Click-Lösung (c't / Heise):
  `heise.de/hintergrund/Ein-Shariff-fuer-mehr-Datenschutz-2467514.html`
