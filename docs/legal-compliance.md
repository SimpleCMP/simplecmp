# Legal compliance reference — consent banner design

Status: synthesis as of **2026-05-31**. Covers GDPR, ePrivacy
Directive, DSA, EDPB output, BGH/CJEU case law, DSK/CNIL/AP/DSB/EDÖB
guidance, and current enforcement trends. **Reference material — not
legal advice.** This doc drives technical design decisions for
SimpleCMP defaults and template variants; operators of deployed sites
should run any specific deployment past their own legal counsel.

The audience is engineers reading this to scope a feature ("can we
ship template X?", "is this default safe?", "does the bundle warn
about this risk?"). Sections 1–2 lay out the binding constraints,
section 3 marks the gray zone, section 4 translates everything into
concrete template implications, section 5 sources every claim.

## 1. Hard requirements

These translate directly into UI / technical contracts the banner
MUST satisfy.

### 1.1 Active opt-in only — no pre-ticked boxes, no scroll-as-consent

Pre-selected checkboxes do not constitute valid consent
([CJEU C-673/17 Planet49](https://gdprhub.eu/CJEU_-_C-673/17_-_Planet49),
confirmed by [BGH I ZR 7/16 "Cookie II"](https://www.bits.gmbh/schon-wieder-cookies-bgh-urteilt-zur-einwilligungspflicht/),
28.05.2020). Scrolling, "continue surfing", or any inactivity is
ruled out by the [EDPB Guidelines 05/2020 on Consent (v1.1, May
2020)](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf)
and reaffirmed by the
[DSK Orientierungshilfe Telemedien 2021 v1.1 (Dec 2022)](https://www.datenschutzkonferenz-online.de/media/oh/20221205_oh_Telemedien_2021_Version_1_1_Vorlage_104_DSK_final.pdf).

**Translation.** All toggles default to OFF. No `checked` attribute
on checkboxes. No event listener on `scroll` / `click-on-page` that
registers consent. Closing the banner with the `Esc` key or browser
back-button must equal "no consent given", not implicit acceptance.

### 1.2 Reject must be as easy as Accept — same layer, same effort, equal prominence

GDPR Article 7(3) ("as easy to withdraw as to give") + Article 4(11)
("freely given"). Made concrete by the
[EDPB Cookie Banner Taskforce Report (Jan 2023)](https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf),
the
[CNIL Recommendation of 17.09.2020](https://www.hunton.com/privacy-and-cybersecurity-law-blog/cnil-publishes-updated-cookie-guidelines-and-final-version-of-recommendations-on-how-to-get-users-consent),
and the
[DSK Orientierungshilfe v1.1](https://www.slk-rechtsanwaelte.de/blog/dsk-update-zu-cookie-bannern-version-1-1-mit-neuen-anforderungen/).

The Austrian DSB
([D124.0507/24, 28.10.2024](https://gdprhub.eu/index.php?title=DSB_%28Austria%29_-_D124.0507%2F24_2024-0.633.166))
and Austrian BVwG (upheld in
[noyb v. ORF.at](https://noyb.eu/en/noyb-success-orfat-must-correct-misleading-cookie-banner))
made this concrete: a less prominent reject color/contrast is an
order-to-redesign offense.

**Translation.** Buttons must share identical CSS-relevant properties:
size (`width`, `height`, `padding`), font (`font-family`, `font-size`,
`font-weight`), shape (`border-radius`), color contrast ratio against
the banner background ≥ WCAG AA (3:1 for large text, 4.5:1 normal),
and visual hierarchy (no one button styled as primary, the other as
secondary/ghost/link). Number of clicks to refuse ≤ number of clicks
to accept.

### 1.3 A "Reject" affordance must be available on the first layer

The
[VG Hannover, 19.03.2025, 10 A 5385/22](https://www.wbs.legal/it-und-internet-recht/datenschutzrecht/vg-hannover-zu-einwilligungsbutton-cookie-banner-brauchen-alles-ablehnen-schaltflaeche-82973/)
held that "Accept all + Settings" without a first-layer "Reject all"
is unlawful. A "Settings" link that only leads to a second layer with
the reject option is insufficient.

Caveat: the
[delegedata analysis](https://www.delegedata.de/2025/05/zum-cookie-banner-urteil-des-vg-hannover-gericht-verpflichtet-nicht-zu-alles-ablehnen-schaltflaeche/)
argues VG Hannover did not establish an _absolute_ requirement of a
literally-labeled "Reject all" button — but the underlying principle
(rejection equally easy on first layer) is settled. The EDPB Taskforce
noted a "vast majority" of DPAs require this; the
[Dutch AP](https://www.autoriteitpersoonsgegevens.nl/en/themes/internet-and-smart-devices/cookies/clear-cookie-banners)
and
[CNIL](https://www.cnil.fr/en/cookies-equally-easily-accepted-or-refused-cnil-sends-second-series-orders-comply)
treat it as binding.

**Translation.** The first visible banner state has a button (not a
text link) whose semantic action is "reject all non-essential". Accept
and Reject share the same DOM-layer / z-index modal / sticky-region.
A "Settings" button is permitted as a third option but cannot be the
only path to reject.

### 1.4 Granular consent — per purpose, per controller

GDPR Article 6(1)(a) + EDPB 05/2020 paragraph 42 ff. Consent must be
specific to each processing purpose. Bundling "analytics + advertising
+ personalization" under one toggle is invalid.

**Translation.** Service-level granularity in the settings layer at
minimum. Each toggle maps to one purpose category. "Accept all" may
bundle, but only because the user is given the per-purpose alternative
on the second layer.

### 1.5 Clearly identify all controllers receiving data

[CJEU C-604/22 IAB Europe (07.03.2024)](https://www.hunton.com/privacy-and-information-security-law/cjeu-rules-on-iab-europes-transparency-and-consent-framework):
the TC String (identifier carrying consent flags) is personal data and
the operator is a controller for its own consent record. Article 13
GDPR information must be presented before consent is captured.

**Translation.** The first layer must name (or link to) the controller,
identify joint-controller arrangements, and link to the list of
third-party recipients before the user clicks. Vendors must be
enumerable, not abstracted behind "our partners".

### 1.6 Consent withdrawal must be permanently accessible — and as easy as granting

GDPR Article 7(3). Withdrawal cannot require account creation, email
contact, or finding a buried link in the privacy policy.

**Translation.** A persistent floating/sidebar/footer trigger (e.g.
"Cookie settings", "Privacy preferences") must reopen the banner from
anywhere on the site, with one click, on every page. Localized label.
Keyboard-reachable. Not behind a hamburger menu or in a non-obvious
footer column. (SimpleCMP's `floatingTrigger` config maps to this.)

### 1.7 No cookies / no JS tracking before consent

§ 25
[TDDDG (formerly TTDSG since 14.05.2024)](https://gesetz-tdddg.de/)
and Article 5(3) ePrivacy Directive (2002/58/EC). Only strictly
necessary storage/access is exempt. The Dutch AP imposed a
[€600,000 fine on a pharmacy](https://syrenis.com/resources/blog/dutch-regulator-cookie-enforcement/)
for setting tracking cookies before banner interaction. VG Hannover
specifically held that even loading Google Tag Manager requires prior
consent.

**Translation.** No third-party `<script>` tags, no tracking pixels,
no `document.cookie` writes, no `localStorage` writes for non-essential
purposes until the consent state is `granted`. The CMP itself may set
one strictly-necessary cookie storing the choice, with documented
purpose. (SimpleCMP's universal pre-consent blocking — ADR-0013 — and
the JS-injected interceptor patches address this for both declarative
and runtime-injected resources.)

### 1.8 Document and audit-trail the consent

GDPR Article 7(1) (controller must demonstrate consent).
[EinwV § 4 (in force 01.04.2025)](https://www.gesetze-im-internet.de/einwv/BJNR0200B0025.html)
imposes specific documentation duties on certified PIMS.

**Translation.** Persist `{ timestamp, banner-version, banner-text-hash,
choices-per-purpose, CMP-version }` server-side or in a verifiable
local audit log. Make the record portable so the user can request a
copy.

### 1.9 Information clarity — plain language, no legalese, no dark obfuscation

EDPB 05/2020 paragraph 67 ff. + DSA Article 25(1). Vague terms ("we
use partners to enhance your experience") fail the "informed" prong.

**Translation.** First-layer copy names concrete purposes ("Analytics
with IP address transmission to Google LLC, USA"). Plain reading-level
(B1 German / equivalent). Avoid double negatives ("Do you want to not
opt out of …").

## 2. Dark patterns explicitly forbidden

Taxonomy from
[EDPB Guidelines 03/2022 v2.0 (adopted 14.02.2023)](https://www.edpb.europa.eu/system/files/2023-02/edpb_03-2022_guidelines_on_deceptive_design_patterns_in_social_media_platform_interfaces_v2_en_0.pdf).
Although nominally about social media, all DPAs apply the same lens to
consent banners.
[DSA Article 25(1)](https://dsa-library.com/article/25/)
(in force 17.02.2024) codifies a separate prohibition on platforms;
for non-VLOPs, the GDPR + ePrivacy enforcement route is the relevant
one.

### 2.1 Overloading

User is flooded with options/text to exhaust attention. Concretely:
TCF-style banners listing 800 vendors per purpose, or 12 purpose
categories on layer one.

**Countermeasure.** Cap layer-one purposes at 4–6 high-level categories
with progressive disclosure. Vendor lists in expandable accordions, not
flat lists.

### 2.2 Skipping

The reject path is harder than the accept path. Variant patterns:
reject-via-link vs. accept-via-button, reject behind "Settings",
reject requires per-vendor unticking, an "x" close button that
registers as accept (explicitly flagged unlawful by
[VG Hannover 10 A 5385/22](https://www.dr-datenschutz.de/urteil-vg-hannover-wie-muessen-cookie-banner-gestaltet-sein/)).

**Countermeasure.** Single "Reject all" button on layer one. Closing
the banner via `x`, `Esc`, or backdrop click MUST equal reject (or
persist banner). No `x` icon doubling as accept.

### 2.3 Stirring

Emotional/visual nudging: vibrant green accept vs. faded grey reject;
"Improve your experience" framing for accept; sad-face icons on reject;
pre-prominence via size/weight.

**Countermeasure.** Identical button styling. Neutral copy ("Reject
all", not "Reject and have a worse experience"). No marketing language
in either path.

### 2.4 Hindering

Friction added to the privacy-positive path: "Save settings" demands
scroll-through, mandatory waiting periods, deeply nested toggles, or
reject-all only after toggling each category off individually.

**Countermeasure.** "Reject all" works in one click regardless of
toggle state. "Save selected choices" never blocked by mandatory
acknowledgements. No "are you sure?" interstitial on reject.

### 2.5 Fickle (Inconsistent)

Settings layout changes between visits, toggles flip semantics
("on = consent" vs. "on = decline"), labels drift between layers.

**Countermeasure.** Consistent toggle semantics — on always = consent
given. Same banner structure across pages. Same labels on first and
second layers. The persistent revocation trigger always opens the same
UI.

### 2.6 Left in the Dark

Critical info hidden, e.g. third-country transfers buried, the
legitimate-interest basis silently default-on, an "essential cookies"
category that secretly includes analytics.

**Countermeasure.** First-layer mention of third-country transfers when
present (especially US under the
[EU–US Data Privacy Framework](https://commission.europa.eu/system/files/2023-07/Adequacy%20decision%20EU-US%20Data%20Privacy%20Framework_en.pdf)).
"Essential" category is enumerated and audited (e.g. session cookie,
CSRF, language preference, consent record itself — and only those).

### 2.7 Additional concrete bans from enforcement

- **Color contrast manipulation.** Austrian DSB explicitly cited WCAG
  3:1 minimum and ruled prominent dark-blue accept against pale-white
  reject as a violation
  ([DSB D124.0507/24](https://gdprhub.eu/index.php?title=DSB_%28Austria%29_-_D124.0507%2F24_2024-0.633.166)).
- **Reject-as-link rather than button.** Vast majority of DPAs in
  [noyb 2024 Cookie Report](https://noyb.eu/sites/default/files/2024-07/noyb_Cookie_Report_2024.pdf)
  treat this as deceptive.
- **"Legitimate interest" pre-toggled-on.** Invalid because cookie
  placement itself (ePrivacy 5(3)) requires consent, not LI
  ([Brussels Court of Appeal 2024 follow-up to IAB Europe TCF](https://privacymatters.dlapiper.com/2025/06/eu-brussels-court-of-appeal-rules-on-iab-europe-and-the-tc-string-implications-for-gdpr-compliance/)).
  LI toggles on layer-two ad/analytics categories are an enforcement
  target.
- **Loading Google Fonts / Google Tag Manager / similar pre-consent.**
  Even when "necessary" framing, treated as unlawful US transfer in DE
  ([LG München I, 20.01.2022, 3 O 17493/20](https://www.the-boutique-agency.de/en/magazin/google-fonts-gdpr-compliance);
  VG Hannover 2025).

## 3. Open questions and unsettled law

### 3.1 Pay-or-OK / Consent-or-Pay

[EDPB Opinion 08/2024 (17.04.2024)](https://www.edpb.europa.eu/our-work-tools/our-documents/opinion-board-art-64/opinion-082024-valid-consent-context-consent-or_en)
ruled that for _large online platforms_, a binary "pay or accept
tracking" cannot satisfy "freely given". Authorities recommend an
"equivalent alternative" without behavioural advertising. Status:
contested by Meta and IAB Europe; some German publishers continue to
operate Pur-models. **Trend: tightening**; courts increasingly side
with the EDPB view, but for non-platform-sized publishers it is
unclear when "imbalance of power" kicks in.

**CMP implication.** Support but flag — make the implementation
explicit and require operator-side configuration so the operator owns
the compliance call.

### 3.2 Legitimate interest as a separate "Allow LI" layer

The IAB TCF model presents users with consent toggles _and_ a separate
set of "object to legitimate interest" toggles. After
[CJEU C-604/22](https://www.osborneclarke.com/insights/digital-ad-ruling-cjeu-finds-iab-europe-joint-controller-consent-tcf-processing)
and the Brussels Court of Appeal follow-up, this dual layer is in
serious doubt for cookie placement scenarios. **Trend: against LI for
tracking placement.** Some DPAs (BlnBDI, AP) have signaled they will
treat LI tabs as deceptive design.

### 3.3 Strictly necessary scope

DPAs disagree on edge cases: A/B testing, fraud prevention,
server-side analytics with anonymized IPs, security telemetry. The
[EDPB Taskforce Report](https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf)
explicitly noted divergence and refused a unified list. **Trend:
shrinking** — DPAs are excluding ever more from "strictly necessary".

### 3.4 Browser signals / Global Privacy Control / EinwV PIMS

[EinwV (in force 01.04.2025)](https://www.gesetze-im-internet.de/einwv/BJNR0200B0025.html)
sets up the first national PIMS framework — the first recognised
service "Consenter" was approved by BfDI on 17.10.2025. The
[EU Digital Omnibus proposal of 19.11.2025](https://www.osborneclarke.com/insights/digital-omnibus-reshapes-eu-cookie-rules-leaves-banner-fatigue-largely-intact)
plans to merge cookie rules into the GDPR and mandate browser-level
signals. **Trend: signals will become first-class within ~2027.**

**CMP implication.** Plan for a future state in which a `Sec-GPC` or
PIMS-supplied preference auto-suppresses the banner.

### 3.5 "X"-button semantics

VG Hannover declared "Accept & close X" unlawful, but did not clarify
the inverse — whether a top-right "X" must equal reject, or merely
"no decision yet" (banner reappears). CNIL appears to require
persistence; DSK is silent. **Trend: closing the banner without choice
cannot register as consent** — the safe default is persistence (banner
re-shown) or reject.

### 3.6 Layered banners and "informed" standard

Some DPAs (CNIL, AP) accept a short first layer + detailed link;
others (parts of DSK) want categorical purposes already on layer one.
**Trend: convergence on "two-layer is fine if first layer is concrete
enough".**

### 3.7 DSA Art. 25 overlap with GDPR

The EU Commission has not enforced Art. 25 directly against
consent-banner designs — its enforcement focus has been VLOP feed
design, recommender systems, and addictive features. National DPAs
remain the GDPR/ePrivacy path. **Trend: until first DSA cookie-banner
enforcement action, treat Art. 25 as additive principle, not new
technical obligation.**

### 3.8 AI Act overlap

The
[AI Act (Regulation 2024/1689)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
prohibits subliminal/manipulative techniques but the relevant articles
(Art. 5) target high-risk AI systems. Consent banners don't usually
fall into scope unless the banner itself uses AI personalization.
**Not a current driver.**

## 4. Concrete template implications

### 4.1 Clearly legal (safe defaults)

| Property | Value |
|---|---|
| Buttons on layer 1 | Three: **Reject all** / **Settings** / **Accept all** — or two: **Reject all** / **Accept all** with a separate "Customize" text link of equal prominence |
| Button order | Reject left, Accept right OR Accept left, Reject right — consistent within site, no preferred ordering required |
| Button styling | Identical: same `width`, `padding`, `font-weight`, `border-radius`, `background-color`, `color`, contrast ≥ 4.5:1 |
| Reject label | "Alle ablehnen" / "Reject all" / "Nur essentielle" / "Refuse all" |
| Accept label | "Alle akzeptieren" / "Accept all" — never "Accept and improve experience" |
| Settings label | "Einstellungen" / "Anpassen" / "Settings" / "Customize" — actual button (not muted link) |
| First-layer text | Names purposes (e.g. "Analyse, Marketing, externe Medien"), names key controllers or links to vendor list, names third-country transfer if relevant, links to full privacy policy |
| Default toggle state | All non-essential = OFF |
| Close behavior (`x`, Esc, backdrop click) | Banner re-renders OR registers reject — never accept |
| Persistent revocation trigger | Footer link "Cookie-Einstellungen" + optional floating icon, reachable from every page, keyboard-focusable |
| Save-selected button | Required IF a Settings layer with per-category toggles is offered (so the user can persist a partial selection); not required if only Accept-all/Reject-all are exposed |
| Per-purpose granularity in Settings | One toggle per purpose category; vendors listed within |
| Audit log | Persisted `{timestamp, version, hashed-text, choices}` for each consent action |

### 4.2 Gray zone (operator must justify case-by-case)

| Property | Status |
|---|---|
| Reject only via Settings layer | Almost certainly illegal in DE/AT/NL/FR after 2024–2025 rulings; may survive in jurisdictions without an explicit first-layer reject ruling. **Don't ship as default template.** |
| Different colors for Accept vs. Reject even if both pass WCAG AA | Risky. CNIL and DSB treat this as nudging; safer to use identical styling and rely on label-only differentiation. |
| Single "OK / I understand" button when only strictly-necessary processing happens | Permitted (no consent banner legally required at all), but then must not appear together with any pre-loaded tracking — otherwise it becomes a deceptive design. |
| Pay-or-OK | Legal for non-platforms in some jurisdictions, illegal for VLOPs per EDPB. Implement as opt-in operator feature with warning in admin UI. |
| "Legitimate interest" toggles on layer 2 | Increasingly treated as illegal for cookie placement. Default OFF in any case. Prefer not to expose at all. |
| Cookie-wall (no entry without consent) | Illegal except where service genuinely cannot run without the processing (rare, and not for marketing). |

### 4.3 Clearly illegal (never ship these patterns)

- Single "Accept all" + "More info" link as the only options on
  layer 1.
- "Accept all" prominently styled + "Reject all" as a low-contrast
  text link.
- Pre-checked toggles for any non-essential purpose.
- `x` close button that registers as accept.
- Reject available only after toggling each category off manually.
- "Continue to site" framed as accept (deemed consent via
  interaction).
- Tracking that fires before the user has chosen anything.
- "Save settings" disabled until user accepts at least one
  category.
- Bundled consent for incompatible purposes (analytics + advertising
  under one toggle).
- More clicks to reject than to accept.

### 4.4 Component-level checklist for SimpleCMP defaults

- Layer 1: 3-button row (`Reject all` | `Settings` | `Accept all`),
  all `<button>` elements, equal CSS class, no `primary` / `secondary`
  modifier.
- Layer 2 (Settings): per-purpose toggles, all default OFF, with
  "Reject all" + "Save selected" + "Accept all" footer (all three same
  styling).
- Per-purpose card: name, plain-language purpose description,
  retention period, list of vendors/controllers, link to vendor
  privacy policy.
- Vendor list: expandable per purpose, machine-readable backing data
  (so operators can audit).
- Audit log entry on every choice — purpose-level, with banner-text
  version hash.
- Persistent footer trigger emitted by the CMP container; works
  without JS-routing tricks.
- Keyboard: full reachability, focus-trap in modal, `Esc` re-renders
  (no consent), focus restored on close.
- `prefers-reduced-motion` respected for any animation.
- WCAG AA contrast self-check on render; operator gets a build-time
  warning if button styling violates.
- Translation surface: every label, purpose name, vendor entry
  localizable; default DE/EN included.
- "Legitimate interest" mode: off by default, opt-in only with
  operator warning copy in admin UI.
- Pay-or-OK mode: off by default, opt-in only with explicit operator
  acknowledgement.
- Static prerender / no-JS fallback: the banner does not consent on
  its own; absence of JS = no consent registered = no tracking loaded.

### 4.5 US (brief)

[CCPA/CPRA](https://oag.ca.gov/privacy/ccpa) and
[Colorado CPA (universal opt-out mandatory since 01.07.2024)](https://www.duanemorris.com/alerts/colorado_privacy_act_requires_universal_opt_out_starting_july_1_2024_0424.html)
are opt-out regimes, not opt-in. The required UI element is a "Do Not
Sell or Share My Personal Information" or "Your Privacy Choices" link
plus honoring
[Global Privacy Control](https://www.cookieyes.com/blog/global-privacy-control/)
(`Sec-GPC: 1` header). No banner is required by US law.

**Template implication.** Support a US-mode that suppresses the modal
and renders only a footer link + GPC handler. Don't try to unify
EU-opt-in and US-opt-out UX into one component.

## 5. Sources

### EU primary law and guidelines

- [GDPR — Regulation (EU) 2016/679, esp. Art. 4(11), 6(1)(a), 7, 13](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [ePrivacy Directive 2002/58/EC, Art. 5(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219)
- [Digital Services Act — Regulation (EU) 2022/2065, Art. 25](https://dsa-library.com/article/25/)
- [EDPB Guidelines 05/2020 on Consent (v1.1)](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf)
- [EDPB Guidelines 03/2022 v2.0 on Deceptive Design Patterns (adopted 14.02.2023)](https://www.edpb.europa.eu/system/files/2023-02/edpb_03-2022_guidelines_on_deceptive_design_patterns_in_social_media_platform_interfaces_v2_en_0.pdf)
- [EDPB Cookie Banner Taskforce Report (18.01.2023)](https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf)
- [EDPB Opinion 08/2024 on Consent or Pay (17.04.2024)](https://www.edpb.europa.eu/system/files/2024-04/edpb_opinion_202408_consentorpay_en.pdf)
- [EU Digital Omnibus proposal (19.11.2025)](https://www.osborneclarke.com/insights/digital-omnibus-reshapes-eu-cookie-rules-leaves-banner-fatigue-largely-intact)

### CJEU case law

- [CJEU C-673/17 Planet49 (01.10.2019) — pre-ticked checkbox invalid](https://gdprhub.eu/CJEU_-_C-673/17_-_Planet49)
- [CJEU C-604/22 IAB Europe (07.03.2024) — TC String is personal data; joint controllership](https://www.hunton.com/privacy-and-information-security-law/cjeu-rules-on-iab-europes-transparency-and-consent-framework)

### Germany

- [BGH I ZR 7/16 "Cookie II" (28.05.2020)](https://www.bits.gmbh/schon-wieder-cookies-bgh-urteilt-zur-einwilligungspflicht/)
- [DSK Orientierungshilfe für Anbieter von Telemedien v1.1 (Dec 2022)](https://www.datenschutzkonferenz-online.de/media/oh/20221205_oh_Telemedien_2021_Version_1_1_Vorlage_104_DSK_final.pdf)
- [TDDDG (formerly TTDSG), § 25, in force as TDDDG since 14.05.2024](https://gesetz-tdddg.de/)
- [Einwilligungsverwaltungsverordnung (EinwV), in force 01.04.2025](https://www.gesetze-im-internet.de/einwv/BJNR0200B0025.html)
- [VG Hannover, 19.03.2025, 10 A 5385/22](https://www.wbs.legal/it-und-internet-recht/datenschutzrecht/vg-hannover-zu-einwilligungsbutton-cookie-banner-brauchen-alles-ablehnen-schaltflaeche-82973/)
- [LfDI Niedersachsen press release on VG Hannover ruling](https://www.lfd.niedersachsen.de/startseite/infothek/presseinformationen/urteil-zu-manipulativem-cookie-banner-alles-ablehnen-schaltflache-ist-ein-muss-241960.html)
- [LfDI Baden-Württemberg FAQ Cookies und Tracking](https://www.baden-wuerttemberg.datenschutz.de/faq-zu-cookies-und-tracking-2/)
- [LG München I, 20.01.2022, 3 O 17493/20 — Google Fonts](https://www.the-boutique-agency.de/en/magazin/google-fonts-gdpr-compliance)

### Austria

- [DSB D124.0507/24 (28.10.2024) — ORF cookie banner](https://gdprhub.eu/index.php?title=DSB_%28Austria%29_-_D124.0507%2F24_2024-0.633.166)
- [BVwG / VwGH Ra 2024/04/0424 (upheld ORF order)](https://gdprhub.eu/index.php?title=VwGH_-_Ra_2024/04/0424)

### Switzerland

- [revDSG (FADP, in force 01.09.2023)](https://www.fedlex.admin.ch/eli/cc/2022/491/en)
- [EDÖB Leitlinien zu Cookies v1.1 (06.10.2025)](https://e-dialog.group/blog/consent-management/cookie-banner-2025-was-schweizer-webseitenbetreiber-wissen-muessen/)

### France

- [CNIL Lignes directrices cookies (rev. 17.09.2020) + Recommandation finale](https://www.hunton.com/privacy-and-cybersecurity-law-blog/cnil-publishes-updated-cookie-guidelines-and-final-version-of-recommendations-on-how-to-get-users-consent)
- [CNIL enforcement orders 2nd wave on equal accept/refuse](https://www.cnil.fr/en/cookies-equally-easily-accepted-or-refused-cnil-sends-second-series-orders-comply)

### Netherlands

- [Autoriteit Persoonsgegevens — Clear cookie banners guidance](https://www.autoriteitpersoonsgegevens.nl/en/themes/internet-and-smart-devices/cookies/clear-cookie-banners)
- [AP enforcement campaign 2024–2025 (warning letters, fines, 10k automated scan)](https://www.pinsentmasons.com/out-law/news/dutch-data-protection-authority-misleading-cookie-banners)

### Belgium

- [APD/GBA 37/2024 — IAB Europe TCF binding decision](https://gdprhub.eu/index.php?title=APD%2FGBA_%28Belgium%29_-_37%2F2024)

### Activist / NGO complaints campaigns

- [noyb Cookie Report 2024 (11.07.2024)](https://noyb.eu/sites/default/files/2024-07/noyb_Cookie_Report_2024.pdf)
- [noyb Cookie Banner Project 2021– (560+ complaints, 33 countries by June 2025)](https://noyb.eu/en/project/cookie-banners)

### US

- [California CCPA/CPRA Regulations](https://oag.ca.gov/privacy/ccpa)
- [Colorado Privacy Act — Universal Opt-Out Mechanism mandatory 01.07.2024](https://www.duanemorris.com/alerts/colorado_privacy_act_requires_universal_opt_out_starting_july_1_2024_0424.html)
- [Global Privacy Control specification (W3C CG)](https://globalprivacycontrol.org/)