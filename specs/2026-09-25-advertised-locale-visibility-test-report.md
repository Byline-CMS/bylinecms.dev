---
title: "Advertised locale visibility — test report"
path: "advertised-locale-visibility-test-report"
summary: "Traceable mapping of every contract in the issue 102 specification to the tests and browser observations that verify it."
---

# Advertised locale visibility — test report

Companions:

- [Specification](./2026-09-25-advertised-locale-visibility-spec.md) defines each contract named below.
- [Implementation plan](./2026-09-25-advertised-locale-visibility-plan.md) defines the contract IDs, the phases, and the manual walkthrough.

This report maps each contract ID in the plan (R1–R7, then L1 through C3) to the tests and browser observations that verify it on branch `feat/advertised-locale-visibility`. Read it when you review the #102 implementation or need to find the test that pins a particular rule. Each checkpoint was reviewed by a second agent against a pinned snapshot. The red evidence cited for each checkpoint means the named tests failed when the checkpoint's source was reverted or a regression was injected.

## Commits

| Checkpoint | Commit | Scope |
|---|---|---|
| CP1 | `3dc907df` | Ledger-based fallback selection, independent of projection |
| CP2 | `13ae8468` | `LocaleVisibility` read contracts and authorization |
| CP3 | `e71297d3` | Adapter gate, `resolvedLocale`, `_localeAgnostic`, populate, path identity |
| CP4 | `3901d7ec` | Read-time rich-text refresh replaces derived values |
| CP5 | `773cef75` | Localized filters, sorts, text query, relation hops, tree reads |
| CP6 | `de2e9a9e` | Search indexing and query-time eligibility; both hook sets |
| CP7 | `dc3683de` | Preview reads, preview URLs, discovery suppression, editor copy |
| CP8 | this commit | Cache parity, CLI template prefix, documentation, release notes |

Suite locations used below:

- **Conformance** — `packages/db-conformance/src/suites/*.ts`, run by both `@byline/db-postgres` and `@byline/db-mysql` integration suites.
- **Client** — `packages/client/tests/integration/*.integration.test.ts` (Postgres) and `packages/client/tests/unit/*.test.node.ts`.
- **Core** — `packages/core/src/**/*.test.node.ts`.
- **Webapp** — `apps/webapp/**/*.test.node.ts`.

## Final gate results

On the CP8 tree, with packages built first:

| Command | Result |
|---|---|
| `pnpm test` | pass |
| `pnpm test:integration` | 26/26 tasks: db-postgres 463, db-mysql 483, client 216, search 19 ×2, analytics 10 ×2, cli 2 |
| `pnpm typecheck`, `pnpm knip`, `pnpm knip:exports`, `pnpm docs:check`, `git diff --check` | pass |

## Resolved-locale result types (R1–R7)

| ID | Core (`locale-resolution.test.node.ts`) | Adapters (conformance `locale-visibility`) | SDK (`client-locale-visibility`) |
|---|---|---|---|
| R1 | "R1: fallback reports the selected permitted locale, including the source" | "public fallback serves the source for a complete but unchecked translation" | "a public read falls back for a complete but unchecked translation"; "an authorized published editorial read shows it, with no draft involved" |
| R2 | "R2: omit reports the requested locale" | "public omit excludes an unchecked translation from detail, list and total" | "R2: omit excludes an unchecked translation and returns a checked one" |
| R3 | "R3: public empty with an eligible locale reports it, with no fallback" | "public exact reads serve the source even with every checkbox off" | "R3: public empty returns an eligible locale exactly" |
| R4 | "R4: public empty with an unavailable translation withholds values and reports null"; "R4: public empty still serves the source even when its checkbox is off" | "public empty withholds localized values of an unchecked translation"; "public empty withholds a checked but incomplete translation"; "public empty withholds nested localized values but keeps structure" | "R4: public empty withholds a complete but unchecked translation, nested values included"; "R4: public empty withholds a checked but incomplete translation" |
| R5 | "R5: editorial empty reports the requested locale even when partial" | "an omitted visibility is editorial at the adapter" | "R5: editorial empty returns partial and entirely absent requested values exactly" |
| R6 | "R6: a multi-locale read reports null and restores locale maps" | "a multi-locale editorial read reports a null resolved locale" | "R6: an authorized multi-locale read reports null with locale maps" |
| R7 | "R7: a locale-agnostic version reports null under every policy" | "a locale-agnostic document reports a null resolved locale everywhere"; "batch, version and multi-locale results carry _localeAgnostic" | "R7: a locale-agnostic document reports null and _localeAgnostic on every surface" |

## Contract coverage

| ID | Evidence |
|---|---|
| L1 | Conformance `locale-fallback`: "a title-only list falls back when the body translation is missing", "title-only, full, detail and batch reads choose the same locale", "uses the selected version: published partial, newer draft complete", "omit excludes a partial translation from a title-only list". Client `client-locale-projection`: "a select: [title] list falls back for an incomplete translation", "a populated target projecting only its title falls back the same way". Adapter tests: "a projected list under a changed default falls back to the document source, not the default" (both engines). |
| G1 | Core `isLocaleEligible` cases ("public: a complete but unchecked translation is not eligible", "public: the source is eligible even when its checkbox is off", "public: an empty advertised set authorizes no additional translation"). Conformance: "checking and unchecking a locale changes the next public read", "a checked but incomplete translation stays unavailable", "public omit always admits the source locale, checked or not", "a public exact list read withholds per document". |
| G2 | Conformance: "a collection without advertiseLocales needs completeness but no checkbox", "public empty withholds an incomplete translation even without advertiseLocales". Core: "a non-advertised collection withholds an incomplete translation publicly", `assert-locale-visibility.test.node.ts` "rejects a public locale all read, even for an authenticated actor". Client unit `enforcement.test.node.ts` "rejects a public locale all read on %s" and "singleton get locale visibility (CP2-F1)". |
| G3 | Core `resolveEligibleLocale` "public: a withheld intermediate candidate is skipped". Adapter tests (both engines): "path lookup finds a document whose source differs from the current default", "path lookup never returns an arbitrary document when slugs collide", "a translated path row cannot bypass content eligibility". Conformance: "omit admits the source locale even when the ledger has no row for it". |
| V1 | Conformance: "a draft-only translation stays public-invisible even when checked", "a newer incomplete draft falls back within itself, never to an older version". Client: "an authorized published editorial read shows it, with no draft involved". |
| V2 | Client `client-locale-search`: "indexes the published version, never a newer draft (V2)". Conformance `locale-query-semantics`: "a hop evaluates the target's selected version, not a newer draft". |
| A1 | Core `assert-locale-visibility`: "rejects an anonymous editorial read even with readMode published", "rejects an editorial read with no context". Client unit `enforcement`: "rejects an anonymous editorial read on %s", "denies an editorial read to an actor without the collection read ability", "an explicit public visibility overrides the status any default", "locale visibility uses the effective locale (CP2-F2)". Webapp `preview-reads.test.node.ts`: preview-off reads are `published` / `public`. |
| A2 | Client `client-locale-search`: "drops it even when beforeRead is bypassed". Client populate: "a parent's checked locale does not authorize its target". Existing `client-before-read` and `client-after-read` suites pass unchanged. |
| M1 | Conformance: "public metadata describes the published version while fields obey the checkbox", "public metadata exposes the complete but unchecked published ledger". |
| M2 | Conformance: "a non-localized projection keeps the document resolved locale", "a version read reports the requested locale it restored". Client: "history and version reads … are editorial exact reads that report the requested locale", "tree hydration" cases, populate cases. |
| T1 | Client: "a parent's checked locale does not authorize its target", "a non-advertised parent still gates its advertised target", "editorial visibility reaches populated targets". Conformance: "populate batch reads resolve each target under the requested visibility". |
| T2 | Client: "public subtree and ancestors fall back per node without breaking the spine", "editorial subtree shows the unchecked translations". Conformance `locale-query-semantics` "tree structural reads" group. Webapp `preview-reads`: docs spine check runs only when preview is off. |
| E1 | `packages/richtext-lexical` link and inline-image populate tests: "linkVisitor replaces derived values instead of merging them", "logs at info, removes the old path and marks the link unresolved", "does not reactivate a previously unresolved link with its old path", "inlineImageVisitor replaces derived values instead of merging them", "never serves a stale image when no current image is available", "runLexicalPopulate failed refresh". Client: "rich-text read-time population" cases. |
| E2 | Client: "save-time rich-text embed (F3) — an authenticated save embeds only publicly eligible target values". |
| E3 | Client `client-locale-visibility`, "save-time rich-text embed (F3) — an authenticated save embeds only publicly eligible target values": after the save, the target's checkbox changes, and the snapshot-only field still holds its saved title (`Cible FR`) while the parent's history total stays 1, so no refresh rewrote it and no parent version was minted. Also "read-time refresh changes only the response — reads never mint a parent version". Retention is documented in `docs/04-collections/07-rich-text.md`. |
| Q1 | Conformance `locale-query-semantics`: "a public fallback filter matches the shown source, never the withheld translation", "a public exact read treats a withheld translation as absent, without substituting the source", "the list text query follows the same rule", "an incomplete translation cannot match even without advertiseLocales". |
| Q2 | Conformance: "sorts order by the values the read shows", "sort ties and withheld values order consistently in both directions and across pages". |
| Q3 | Conformance: "relation predicates evaluate each target in its own effective locale", "a non-advertised parent still gates its advertised target", "each hop resolves its own target: advertised topic, then a non-advertised tag", "nested predicates evaluate a node's relation target under its own policy". |
| Q4 | Conformance: "omit filters before count and pagination; full and projected lists agree". Client: "public omit pagination through the SDK (Q4)". |
| S1 | Client `client-locale-search`: "indexes the source, and a complete translation only while it is checked", "never indexes a checked but incomplete translation", "the SDK reindex orchestration applies the same policy". |
| S2 | Client `client-locale-search`: "drops the whole hit from collection search, without hydration or a hook", "drops it from hydrated search too, never substituting the source", "drops it even when beforeRead is bypassed", "drops it from zone search"; `client-zone-search` "public search drops stale index entries…". |
| S3 | Client `client-locale-search`: "a provider page made only of stale hits comes back short, not refilled", and "public aggregates are restricted whenever the eligibility policy applies" (collection and zone), plus "an editorial search keeps the provider aggregate". |
| H1 | Webapp `byline/collections/docs/hooks.test.node.ts`: "%s invalidates public locale surfaces and reindexes a locale-only change" (Docs, News, Pages). CLI `template-docs-hooks.test.node.ts` runtime cases for enable, disable, path, and path plus locale. |
| H2 | Webapp hooks: "%s re-runs cache and index effects on a no-op locale reconciliation retry". Core `document-lifecycle.test.node.ts`: "re-runs reconciliation on a no-op locale-only retry after a committed hook failure", "does not invoke the hook for a plain no-op locale write". |
| H3 | Webapp hooks: "starts indexing even when locale cache invalidation rejects", "reindexes after each committed effect of a combined locale and content save". CLI template: indexing failure propagates through the committed-hook flow. |
| P1 | Browser, CP7 scenario 1 (News `an-english-title-here`, complete published French, unchecked, no draft): anonymous English, preview-off signed-in English, preview French at `/fr/…`. Webapp `preview-reads`: preview reads are `any` / `editorial`. |
| P2 | Browser, CP7 revision: preview off at the same URL returns English; sign-out returns published-only rendering and reads. Sign-out also clears `byline_preview`, so it did not exercise a leftover cookie. Automated: `packages/client/src/server/request-context-factories.test.node.ts` ("returns the same anonymous context per request when no preview cookie is set", "returns the same admin any-mode context per request in preview mode", "falls back to one stable anonymous context when the preview session is stale"), `admin-context.test.node.ts`, `request-context-contract.test.node.ts`, and client unit `enforcement` anonymous-editorial rejections; webapp `public-cache.test.node.ts` for a stale cookie without a session. **Unverified in a browser:** an expired session. The user accepted this gap on 2026-09-25 when approving CP7 (reviewer decision `20260925T123439Z-reviewer-decision-0c9fcea982ab`); it remains unverified, not passed. **Waived by the user:** an account without the collection read ability. |
| P3 | Browser, CP7 revision on the disposable `cp7-fixture`: draft-only Spanish hidden publicly and shown in preview; after Delete Locale, preview falls back to English; an unsaved title is neither shown nor saved (revision and version count unchanged; no stored "UNSAVED" text). The browser could not create a saved *partial* Spanish translation on this fixture: News declares its localized `title`, `summary` and `content` as required, so the editor ("Summary is required") and the SDK update ("Some document fields are invalid") both rejected a Spanish version without a summary. That is a limit of this fixture's required fields, not of Byline: a schema with optional localized fields stores partial translations. The user accepted recording this browser case as not exercised. Partial and incomplete translations are covered by conformance "a checked but incomplete translation stays unavailable", "public empty withholds a checked but incomplete translation", "a newer incomplete draft falls back within itself, never to an older version"; client "R4: public empty withholds a checked but incomplete translation" and "R5: editorial empty returns partial and entirely absent requested values exactly"; and core "R5: editorial empty reports the requested locale even when partial". |
| P4 | Webapp `byline/collections/preview-urls.test.node.ts` (Docs, News, Pages; mocked differing public default). CLI `template-pages-preview.test.node.ts` (content default `fr`, admin default `en`). Host `resolve-preview-url.test.node.ts` unchanged. Browser: Docs and Pages previews keep an unchecked `/es` prefix. |
| U1 | Webapp `alternates.test.node.ts` "preview discovery"; `preview-reads` ledger cleared on preview detail results; `locale-metadata-surfaces.test.node.ts` unchanged. Browser: `/de/about-byline` public menu and `hreflang` present, preview has neither. |
| U2 | Admin `locale-visibility-copy.test.tsx` (5 cases, real English bundle); i18n `index.test.node.ts` "translates the preview and advertised-locale delivery copy in every bundle" plus key parity for all eight bundles. Browser: new widget hints, confirmation copy, and admin-bar titles observed. |
| U3 | Core `document-lifecycle.test.node.ts`: "writes a combined locale and content save in one transaction, locale first", "fails a combined save as a whole when the content version write fails". Browser, CP7 revision: one save request; French public immediately; English edit stays a draft; revision 3 → 4 with one audit row; checkbox-only saves keep version count and status (CP7 scenario 4). |
| C1 | Webapp `src/lib/cache/locale-cache-parity.test.node.ts`: "%s: a locale-only change clears exactly the surfaces unpublish clears" and "%s: a no-op locale reconciliation retry clears the same surfaces again" (Docs, News, Pages; real tagged cache, real hooks; red with News structural invalidation removed). |
| C2 | Same file: "bypasses the shared cache for preview reads in both directions". Webapp `public-cache.test.node.ts`: session cookies produce `private, no-store`. Browser: preview responses `private, no-store`. |
| C3 | Webapp `public-cache.test.node.ts`: anonymous and stale-preview-cookie responses keep `public, max-age=0, s-maxage=60, stale-while-revalidate=86400`. Documented limits in `docs/05-reading-and-delivery/06-caching.md` and the release notes. |

## Limits of this evidence

- Cache parity is local-process evidence: the real tagged cache, the real `withCache` wrapper and the real collection hooks, including cached misses, every locale variant and reconciliation retries. There is **no browser evidence of application-cache eviction**: the development server ran without `CACHING_DATA_REQUESTS`, so the browser observations exercise fresh origin reads only.
- No test claims CDN purge, cluster-wide withdrawal, or protection against a cache fill already in flight. These limits match unpublish.
- The browser walkthrough ran on the Postgres adapter only. The MySQL adapter is covered by the shared conformance suites.
