# Byline analytics

**Status:** implemented.

**Companions:**

- `specs/2026-08-22-scheduler.md` — the shared in-process recurring-task primitive used for
  rollups, retention, and salt expiry.
- `specs/2026-08-22-scheduled-publish.md` — the other initial scheduler consumer.

**Scope:** first-party, privacy-focused web analytics for Byline CMS sites — page views,
visitors, downloads — surfaced in the Byline admin.

**Deployment assumptions:** the constraints in §1 are drawn from one representative
reference deployment — nginx in front of Node on Fly.io, Cloudflare in front of the site hostname,
CloudFront over a private S3 bucket for downloads. They are illustrative of the class of
deployment this design must survive, not a description of any particular installation.

---

## 1. Reference context and portable constraints

The following topology describes the Byline webapp that motivated the subsystem. It is a
deployment scenario, not a requirement of the portable packages. Downstream applications may run
without nginx, Cloudflare, Fly.io, or TanStack Start and must provide equivalent host integration
for their own runtime.

- Hosting: Docker image with **nginx in front of Node.js (TanStack Start)**, deployed on **Fly.io**. Multiple Fly machines per app are possible — no instance-local state.
- **Cloudflare proxies the www hostname.** nginx is already configured to derive the real client IP from `CF-Connecting-IP`. `CF-IPCountry` is available.
- Standard TanStack Router GET responses return **`stale-while-revalidate` with a 60 s TTL**, honored by Cloudflare. Consequence: the origin does NOT see all page traffic. **Origin/nginx logs must never be used as the source of page-view truth.** Router link preloading also fires GETs for pages never viewed.
- Downloads are served from a **separate CDN hostname** (`cdn.<site-domain>`) — a CNAME to an **AWS CloudFront** distribution over a **private S3 bucket (OAC-only access)**. This hostname is NOT behind Cloudflare, and file requests never touch the app.
- Representative database: Postgres. The shipped subsystem must also support Byline's MySQL
  adapter through the same behavioural contract.
- Former Plausible users: the mental model to replicate is Plausible/Umami-style cookieless counting, not GA.

### Non-goals (v1)

No sessions/bounce/duration, no funnels, no UTM campaign reporting, no realtime ticker, no cross-site rollups, no raw-log retention beyond the retention window. Do not add these speculatively.

---

## 2. Architecture summary

Three signals, each collected where it is reliable:

1. **Page views** — client beacon (JS) → an application-owned same-origin POST endpoint. In the reference webapp this is `/telemetry/events`. POSTs are never served from the page cache, so every accepted beacon reaches the application regardless of the SWR cache.
2. **Visitors** — derived server-side at ingest from IP and UA under an installation-local daily salt. No cookie, no client storage, raw IP never persisted.
3. **Downloads** — client click-handler in the same beacon script (v1). Optional later: `/dl/:id` count-and-302 route and/or nightly CloudFront access-log import. Design the events table so these additional sources can feed it without schema change (`source` column).

Analytics ships as an **optional Byline subsystem**, not app-local code and not a mandatory part
of core. `@byline/analytics` owns the framework-independent server contract: ingest, aggregation,
queries, privacy rules, and task definitions. The dependency-free `@byline/analytics-agent`
package owns the framework-independent browser collector. `@byline/analytics-postgres` and
`@byline/analytics-mysql` own their schemas, numbered migrations, and stores, following the search
subsystem precedent. The private `@byline/analytics-conformance` workspace package holds the one
behavioural suite both SQL drivers must pass; it is test infrastructure and never an application
dependency. The TanStack Start host provides optional agent-response, committed-navigation,
request-bridge, and authenticated admin helpers. The application chooses and mounts the agent and
ingest routes. The admin package owns the optional dashboard module and registers `analytics.read`
and `analytics.maintain` abilities.

An installation is one analytics site in v1. Analytics does not introduce a multi-site registry.
The installation config supplies its allowed public domains, optional CDN hosts, ignored path
prefixes, and storage provider. Installation identity and domain ownership come from server
configuration; the browser selects neither and the event tables do not need a `site_id` column.

---

## 3. Component A — beacon script

A single first-party script, **≤ 2 KB gzipped**, no dependencies, served from the site's own origin.

- **Serve under an innocuous first-party path** (e.g. `/b.js`), not `analytics.js`/`track.js` — common adblock filter lists match those names and would silently distort numbers. Long cache TTL is fine.
- On load: send one `page` event.
- SPA navigations: subscribe to TanStack Router's **committed/resolved navigation event** — never link hover, never preload/prefetch. Ignore hash-only and search-only changes by default (configurable). Suppress an identical consecutive navigation identity until a different identity is observed, and gate the initial view with a module-level "sent" flag so React remounts or consent re-grants during one document lifetime do not recount it. The server still removes query strings and fragments, so configured search/hash changes add views to the normalized pathname rather than creating separate stored paths.
- Downloads: one **delegated click listener** on `document` matching `a[href]` where the host equals the site's configured CDN host(s) **or** the pathname ends in a configured extension list (default: pdf, zip, docx, xlsx, pptx, csv, mp3, mp4, epub). Sends a `download` event with the file path. Do not preventDefault; do not delay navigation (use `sendBeacon`).
- Transport: `navigator.sendBeacon(config.endpoint, blob)`; fallback `fetch(..., { keepalive: true })`. The application must supply a same-origin, root-relative endpoint. Fire-and-forget; never retry (retries are how client bugs become data corruption).
- **The endpoint is same-origin by construction.** The configured root-relative path always addresses the origin serving the page, regardless of where the JavaScript artifact itself is hosted. An installation with several public domains does not change that: each domain serves its selected endpoint. V1 supports no cross-origin ingest and the endpoint emits no CORS headers at all. Be precise about what that does and does not achieve: because the beacon sends a safelisted `text/plain` body with no custom headers, it is a *simple* request, so a cross-origin page can still **send** it and the server will still receive it. Omitting `Access-Control-Allow-Origin` only denies the sending page the ability to **read the response** — which the beacon never reads anyway. **The origin check in §4 is what actually drops cross-origin submissions**, not the absence of CORS headers. Emitting none is the right default because there is no response any caller needs to read, not because it is a filter.
- **The body is nevertheless sent as `text/plain`, not `application/json`**, and the server parses it as JSON. `application/json` is not a CORS-safelisted content type, so a beacon carrying it becomes preflighted the moment the endpoint is not same-origin — and a preflight issued as the page unloads is the one that does not complete. Same-origin the distinction is invisible, which is exactly why it is worth fixing now: `text/plain` costs nothing, keeps the request preflight-free by construction, and means a future absolute or configurable endpoint cannot silently start losing page views. Plausible and Umami send `text/plain` for the same reason.
- Payload (JSON text, ≤ 1 KB): `{ v: 1, kind: "page" | "download", path: "/…", ref: document.referrer }`. **No site id and no client timestamp** — configuration selects the installation and the server stamps time. Nothing else.
- Opt-out: no-op when `localStorage["byline-analytics-ignore"]` exists. Reading this flag is fine —
  it is set only by the explicit "exclude my visits on this browser" action in the Byline UI.
  Fail silent on any error.
- The script must not set cookies, must not write to localStorage/sessionStorage/IndexedDB, must not read canvas/WebGL/fonts or any fingerprinting surface. This is a hard requirement — it is the basis of the privacy statement.

Global Privacy Control is not treated as a first-party analytics opt-out. GPC expresses a request
not to sell or share personal data with third parties or use it for cross-context targeted
advertising; it is not intended to prohibit first-party processing in the same context. Byline
analytics does none of those things. The agent therefore neither branches on
`navigator.globalPrivacyControl` nor sends the value, and ingest neither branches on nor stores
`Sec-GPC`. If the subsystem later sells, shares, or uses analytics data across contexts, that
change must revisit GPC handling and the privacy statement before it can ship.

`@byline/analytics-agent` builds a minified standalone browser artifact and enforces the 2 KB
gzipped budget in its tests. An application normally places that artifact in the static assets it
already serves and loads it with an ordinary script tag; this requires no framework or build
integration. The reference webapp vendors the published artifact as `public/b.js` and has a drift
test that requires the copy to match the package source exactly. The TanStack Start integration
also offers an optional dynamic-response helper, a Vite development compatibility plugin for that
route-based delivery mode, and an explicit root-layout helper that renders the tag and installs the
small committed-route bridge. Enabling analytics in server configuration does not silently modify
application HTML.
Script configuration that genuinely belongs in the browser, such as CDN hosts and whether
search-only changes count, travels through bounded `data-*` attributes on that tag. Admin paths
(`/_byline` and configured equivalents) are excluded before any event is sent. The agent has no
React or TanStack dependency; another host can feed it committed paths through the same narrow
browser API.

---

## 4. Component B — application-owned ingest endpoint

The application mounts one route in its host framework. The reference webapp uses the TanStack
Start route `POST /telemetry/events`; neither the portable package nor the host helper mounts it.

The complete route must remain testable when a built application is served directly on localhost
through Vite preview or Nitro start. In that mode the host may use the runtime's direct peer
address only when both the request URL and the peer are loopback. This is separate from any fixed
development identity, which must compile out of production builds, and it must not cause a public
request or arbitrary forwarding header to bypass the configured proxy trust boundary.
Local preview tooling must also load a localhost public-domain configuration rather than the
deployment's production hostname; this changes runtime configuration, not the production build.

Processing order (cheap rejections first):

1. **Method/size guard:** POST only; body ≤ 1 KB; parsed as JSON regardless of the declared content type (the beacon sends `text/plain`; see §3) with exactly the known fields; unknown fields → reject. Respond `202` with empty body on accept, `204` on silent drop (see below), `400`/`429` otherwise. Never echo data back.
2. **Origin check:** `Origin` (or `Referer`) must be present and its host must match one of the installation's configured public domains. Mismatch or absence → **silent drop (`204`)**, not an error — don't teach probes what passes. This is a cheap filter, not a security boundary: `Origin` is a request header and anything outside a browser can set it freely. No CORS headers are emitted (see §3).
3. **Path check:** reject configured admin and internal prefixes even if a modified client submits them directly.
4. **Bot filter:** drop if UA matches the maintained `isbot` crawler dataset, pinned through the package lockfile and refreshed deliberately; drop empty/absent UA. When a platform or edge provides verified-bot metadata, consume it only through an explicitly configured host resolver whose trust boundary the deployment controls.
5. **Prefetch filter:** drop `Sec-Purpose: prefetch` / `X-Purpose: preview`.
6. **Visitor hash:** `HMAC-SHA-256(daily_salt, canonical(client_ip, user_agent))` → hex, where `canonical` length-prefixes each UTF-8 component rather than concatenating ambiguous strings. The salt is already unique to this installation and day. `client_ip` comes only from the application host's request-context resolver, using direct runtime facts, verified platform metadata, or an optional trusted-proxy header. **The raw IP must exist only in request scope — never logged, never stored.** Assert in code review that no logger or error object receives it on this route.
7. **Dedupe:** same `(visitor_hash, kind, path)` within 10 s → drop (guards double-fires and naive replays). In-memory LRU per instance is acceptable; imperfect cross-machine dedupe is an explicit accuracy tradeoff.
8. **Insert** into `analytics_event` (§6). `country` from the trusted edge metadata; `referrer_host` = host of `ref`, nulled when it equals an installation domain; `path` normalized (strip query + fragment, cap 512 chars, valid UTF-8, collapse `//`).

### Daily salt (multi-instance safe)

Logical table `analytics_salt(day primary key, salt)`. On first use each UTC day, the driver
performs an insert-if-absent and then reads the winning row, so all machines converge on one
cryptographically random 32-byte salt. The scheduler deletes salts older than yesterday;
yesterday's is kept one day for
clock-skew grace, then destroyed. Destroying it prevents later recovery of the request identity
from the hash. Events carrying the same already-computed hash remain linkable within that UTC
day, which is required to count daily visitors. Never derive salts from a persistent secret.

---

## 5. Component C — reference Cloudflare and nginx recipe

These controls apply to the motivating webapp deployment. Another application documents and tests
the equivalent controls available in its direct server, hosting platform, or chosen proxies.

- Cloudflare (www zone): bypass the application-selected ingest endpoint; keep respecting origin cache headers elsewhere; Bot Fight Mode on; IP Geolocation on. (Add `/dl/*` to the bypass rule if/when the redirect route ships.)
- nginx: `limit_req` on `/telemetry/events` — e.g. zone keyed by the verified real client IP, `rate=5r/s burst=10 nodelay`, return 429. nginx must accept `CF-Connecting-IP` only from current Cloudflare proxy ranges, overwrite any inbound client-supplied forwarding header, and prevent direct origin access from bypassing that trust boundary. The application must receive the normalized value through the host request bridge rather than reading arbitrary forwarding headers itself.
- Cloudflare rate-limiting rule (belt-and-braces): e.g. 120 requests / minute / IP on `/telemetry/events` → managed challenge or block.
- CloudFront: unchanged in v1. (Optional later: standard logging → S3 for the log-import source.)

---

## 6. Component D — schema, rollups, retention

The schema below is logical. Each SQL driver expresses it in its native types and migration
syntax and passes one shared analytics-store conformance suite.

```text
analytics_event
  id, occurred_at, kind, source, path, visitor_hash, referrer_host, country
  index (occurred_at)

analytics_daily_path
  day, kind, path, views, visitors
  primary key (day, kind, path)

analytics_daily_site
  day, views, visitors, downloads
  primary key (day)

analytics_daily_referrer
  day, referrer_host, views, visitors
  primary key (day, referrer_host)

analytics_daily_country
  day, country, views, visitors
  primary key (day, country)

analytics_rollup_state
  singleton, last_complete_day
```

`__other__` is a reserved value of `path` and `referrer_host` in the daily aggregates, holding the
overflow beyond each day's configured cardinality cap (see below). Ingest normalization must not
be able to produce it from a real request.

`kind` is `page | download`; `source` is `beacon | redirect | cdnlog`. The latter two values
reserve event provenance only. A redirect or CDN-log importer still requires its own approved
privacy design before implementation; in particular, delayed CDN logs are incompatible with the
v1 raw-IP and salt-lifetime guarantees unless explicitly reconciled.

The `analytics.rollup` recurring task runs hourly and processes complete UTC days. It enumerates
every day after `last_complete_day` through yesterday, not merely "yesterday", so downtime is
self-healing. Each day is rebuilt transactionally: remove that day's prior aggregate rows, insert
all four aggregate dimensions, and only then advance `last_complete_day`. One day is one
transaction and one batch — never the whole backlog — so a catch-up run neither holds a
connection for its full duration nor competes unboundedly with request traffic. The task
heartbeats its scheduler lease between days, and when it stops on its execution budget with days
still outstanding it returns `workRemaining: true`, so the scheduler re-arms it on the next tick
rather than an hour later. First enablement over a long retained history therefore catches up in
minutes rather than days. A day with no events is
still marked complete. On first enablement, the cursor begins immediately before the earliest
retained event day, or at yesterday when no events exist. Path aggregates include both event
kinds; referrer and country aggregates describe page views only. In site totals, `views` and
`visitors` count page events while `downloads` counts download events. Manual cleanup can rebuild
any retained day without moving the cursor.

The same task deletes events older than **90 days** and expired salts, after catch-up aggregation
succeeds.

### Aggregate cardinality and retention

Aggregate rows are the only record of any period older than the 90-day event window, so discarding
them cheaply is not an option. Retaining them unconditionally is not an option either, for one
reason that is decisive and one that is a qualification.

**Distinct paths are not bounded, and indefinite retention makes that permanent.** `path` arrives
from the client. No attacker is required to exploit this: ordinary scanner traffic requesting
`/wp-admin`, `/.env`, or `/admin123` renders the site's 404 page, the beacon fires with the
requested path, and each one becomes a distinct row. An attacker does better, since `Origin` is a
header and forging it outside a browser is one curl flag. Without a cap, indefinite retention
converts a bounded ninety-day junk problem into a permanent one. The rollup therefore **caps
distinct paths per day** at a configurable limit, ranks by views, and aggregates everything past
the cap into a single reserved `__other__` row per day and kind. The dashboard shows at most
twenty paths, so the cap costs nothing a reader would notice, and `__other__` keeps daily view
totals reconciling exactly. The same cap and reserved row apply to `analytics_daily_referrer`.
`analytics_daily_country` is naturally bounded and needs neither.

The cap defaults to **1,000 distinct paths per day** and may not be configured below the
dashboard's top-N limit of 20, since a cap under that would truncate the only list the dashboard
actually renders. A default in the low thousands keeps the genuine long tail of a real site intact
while still bounding the row count.

**`__other__` sums views but not visitors.** Its `views` is the sum of the overflow rows' views;
its `visitors` is the count of **distinct visitor hashes across the union of all overflow paths**.
Summing each overflow path's visitor count would turn one person who viewed three overflow paths
into three visitors, and the overflow bucket is where that error concentrates. The practical
consequence is that `__other__` cannot be computed by folding together already-aggregated per-path
rows: the rollup must derive it from that day's events directly, in the same pass that produces
the capped rows.

**Aggregates carry no visitor identifier, but path strings are not automatically innocuous.** The
rollup discards every hash: a path aggregate records that a path received twelve views on a day and
cannot link that to any visitor. That is the property that makes long retention defensible, and it
is a genuinely different exposure from `analytics_event`, which holds the same path strings beside
a visitor hash — the higher-risk artifact, already bounded at ninety days. The qualification is
that a path can itself embed an identifier on some sites (`/users/<name>/profile`,
`/orders/<id>`), so indefinite retention of the aggregate does preserve the fact that such a page
was viewed. This design therefore makes retention of `analytics_daily_path` and
`analytics_daily_referrer` **configurable, defaulting to indefinite**, so an installation whose
paths embed identifiers can set a finite window without losing its headline history.
`analytics_daily_site` and `analytics_daily_country` contain no operator-supplied strings and are
retained indefinitely and unconditionally.

Configured retention has a **floor equal to the longest fixed-day period the dashboard offers** —
90 days today, matching the event window. Below that floor the interface would lie: a 30-day path
retention with a 90-day top-pages report renders a period the underlying rows cannot cover. Year to
date and all time do not make the floor unbounded. The reporting contract exposes independent
summary, path, and referrer coverage boundaries, and the dashboard labels a ranked dimension when
its finite retention begins after the selected range.

Growth is therefore bounded by the path cap rather than by traffic: `min(distinct paths, cap) ×
days × kinds`. Index `analytics_daily_path` on `(day)`. Dashboard queries read rollups through `last_complete_day` and raw events for retained
days after that cursor, including today, so a delayed task creates no reporting gap or double
count. Daily-rotating hashes make cross-day distinct visitor counts impossible by design. Every
multi-day visitor value, including per-path, referrer, and country values, is the sum of daily
uniques and must be labelled that way.

---

## 7. Component E — dashboard in Byline admin

Admin reads use TanStack Start server functions, not a new general HTTP API. Every function
requires the registered `analytics.read` ability:

- `getAnalyticsSummary({ from, to })` → `{ views, visitors, downloads, timeseries: [{day, views, visitors, downloads}] }`
- `getAnalyticsReportCoverage()` → `{ summaryFrom, pathsFrom, referrersFrom }`, where a finite path or referrer retention policy may produce a later boundary than headline history
- `getAnalyticsTop({ kind, from, to, limit: 20 })` → `{ rows: paths with views/visitors, total }`, where `total` is the distinct queryable path-key count in the period before the top-N limit. Completed days have already folded keys past the daily cap into one `__other__` key, so this is not the original pre-cap URL count.
- `getAnalyticsReferrers({ from, to, limit: 20 })` → the same `{ rows, total }` shape and post-cap qualification
- `getAnalyticsCountries({ from, to })`

UI: one installation-level page in the admin. Period picker (7 / 30 / 90 days / year to date / all time). Year to date begins on January 1 UTC; all time begins on the earliest raw or headline-rollup day. Three stat tiles (views, daily unique visitors, downloads) use a small timeseries chart, followed by top pages, top downloads, referrers, and countries. Fixed periods chart daily rows; longer periods use explicit seven-day or UTC-month buckets whose visitor readouts remain labelled as sums of daily uniques. Ranked path/download and referrer cards disclose a later coverage boundary when finite aggregate retention truncates that dimension. Keep it to that — "simple, practical, useful" is the product requirement. Include the admin "exclude my visits on this browser" toggle here (sets the ignore flag, §3). Because local storage is origin-scoped, the toggle controls public-page collection only when admin and public pages share an origin; other deployments must provide the same toggle on the public origin.

---

## 8. Abuse resistance (design stance)

An anonymous, cookieless, consent-free endpoint **cannot be fully spoof-proof** — that's true of Plausible/Umami too. The goal is to make junk *expensive to inject, bounded in impact, and cheap to clean*:

- **Bounded, but not identity-secure:** one stable IP+UA pair counts as one daily visitor, but an attacker can rotate UA strings, IPs, or both to create additional hashes. Rate limiting bounds accepted submissions; it does not prove visitor identity. The dashboard is directional product telemetry, not an auditable traffic ledger.
- **Rejected early:** bad or missing Origin, an excluded admin path, bot UA, oversized or malformed payload — all dropped before touching the database. Silent drops (`204`) deny attackers feedback.
- **Rate limited at every configured pre-application boundary:** the reference deployment uses a Cloudflare rule at the edge and nginx `limit_req` at the origin. A direct or platform deployment uses its available equivalent.
- **Cleanable:** an `analytics.maintain`-gated server function or documented CLI deletes events by time range or visitor hash and rebuilds affected retained days. There is no public maintenance endpoint.
- **Observable across application and deployment sources.** The application logs daily counters for accepted events and for the drops it can actually see — origin, admin path, bot, prefetch, missing host-resolved client identity, dedupe, malformed (counts only, no IPs, no hashes). A single dropped total is not diagnostic: the origin check's failure mode is total silent data loss, and a misconfigured domain list is indistinguishable from heavy crawler traffic unless the reasons are separated. Rejections made by a platform or proxy before Node cannot appear in application counters. Any operational runbook must name every configured source, because "accepted events fell" has a different cause depending on which side of the boundary the loss occurred. A > 5× day-over-day spike in accepted events, or any sustained shift in the drop mix, is worth a warning log line.
- **Optional hardening (v2, stub only):** SSR injects `<meta name="ba-token" content="HMAC(installation_secret, utc_date)">`; beacon echoes it; server validates today/yesterday. Cache-compatible (rotates daily, same for all visitors) and blocks naive curl-stuffing — a determined attacker can scrape it, which is why it is optional, not load-bearing.

---

## 9. Privacy statement

`@byline/analytics` provides `createAnalyticsPrivacyStatement()` as a configurable plain-text
snippet for the deployment's privacy page. Engineering must keep it true to the code: any future change that stores raw IPs, adds
client storage, or shares data invalidates the statement. The text is a template, not legal
advice, and must be flagged for counsel review per deployment.

---

## 10. Acceptance criteria

1. Beacon: ≤ 2 KB gzipped; zero cookies and zero client-side storage writes (verify in devtools); no events on route preload/hover; exactly one event per committed navigation incl. back/forward; strict-mode dev double-mount does not double-count.
2. Download clicks on CDN-host links produce `download` events; navigation is not delayed or broken.
3. Ingest: the beacon body is sent as `text/plain` to the configured same-origin endpoint and no preflight request is issued (verify in devtools). Request with wrong Origin or an admin path → 204, nothing stored, and the drop is counted under its own reason. The endpoint returns no `Access-Control-Allow-Origin` header. Bot UA → nothing stored. 1 KB+ body → 400. A configured pre-application rate limiter can return 429. Tests prove that clients cannot select the host-resolved identity for every documented deployment scenario. Raw IP appears nowhere in DB, logs, or error traces.
4. Same visitor across two UTC days yields two different hashes (test with fixed IP/UA, forced salt rotation).
5. Rollup task is idempotent and catches up every missed complete day after simulated downtime, draining at tick cadence rather than one day per hour. Events older than 90 days are pruned. Historical path, referrer, and country queries match hand-computed fixtures.
6. A day containing more distinct paths than the configured cap produces exactly `cap + 1` path rows, the extra being `__other__`, and the sum of the day's path views still equals the day's site view total. A fixture in which one visitor views three overflow paths yields `__other__` visitors of 1, not 3. Configuring retention below the dashboard's longest fixed-day period is rejected at boot. Site and country aggregates are never pruned; path and referrer aggregates honour their configured retention.
7. Dashboard: an actor with `analytics.read` sees data; an actor without it gets 403. The picker accepts fixed-day, year-to-date, and all-time links without silent fallback. Every multi-day visitor value is labelled as a sum of daily uniques, and every finitely retained ranked dimension discloses its later coverage boundary.
8. The Postgres and MySQL providers pass the shared store and rollup conformance suite.
9. `docs/12-analytics/` documents: package/configuration setup, application-owned agent delivery, optional consent, deployment-specific request context, Cloudflare and nginx recipes, salt lifecycle, the path cap and both retention policies, where each drop metric is observed, scheduler health, and the delete/re-rollup maintenance procedure.

---

## 11. Deferred decisions

These are deliberately outside v1 rather than unresolved prerequisites:

1. **Multiple sites in one installation.** V1 is installation-scoped. A later multi-site
   design must introduce a real site registry and permission boundary before adding `site_id`.
2. **Redirect and CDN-log download sources.** The event source vocabulary reserves them, but
   neither ships until its collection accuracy, delayed-delivery behaviour, raw-log retention,
   and privacy statement are designed explicitly. V1 measures download clicks.
3. **Stronger beacon authenticity.** The daily public HMAC token remains optional hardening;
   it is not represented as proof that a human viewed a page.
4. **Cross-day distinct visitors.** Supporting them would require a longer-lived identifier and
   would materially weaken the privacy model. This design does not leave an accidental seam for
   adding one.
