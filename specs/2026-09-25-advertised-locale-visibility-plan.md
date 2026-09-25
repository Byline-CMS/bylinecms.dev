---
title: "Advertised locale visibility — implementation plan"
path: "advertised-locale-visibility-plan"
summary: "Phased implementation and traceable acceptance coverage for advertised-language delivery and authorized preview."
---

# Advertised locale visibility — implementation plan

Companions:

- [Specification](./2026-09-25-advertised-locale-visibility-spec.md) defines the settled behavioral contract, preview semantics, and accepted limitations.
- [Content locales](../docs/08-internationalization/03-content-locales.md) describes the existing storage model.
- [Search authorization after ranking](../docs/06-search/03-search-api.md#authorization-after-ranking) defines restricted search totals and pagination.
- [Testing](../docs/13-testing.md) describes package test modes and manual browser verification.

Date: 2026-09-25. Status: revised plan ready for review against the settled specification. Code baseline: `1ac9287a`. Issue: [#102](https://github.com/Byline-CMS/bylinecms.dev/issues/102). This replaces the earlier four-phase plan, including its superseded cache and snapshot requirements. No runtime code has been changed by this planning task.

## Scope and sequencing

Implement the settled specification without reopening its product decisions. Public delivery requires a selected published version and, for additional languages in advertised collections, a checked and complete translation. Editorial preview remains authorized, uses saved content, and may inspect unchecked translations. Public `empty` reads withhold unavailable localized values; public `all` reads are rejected. Public completeness metadata may remain visible but must describe the selected published version.

The following sizes describe relative engineering and review effort, not elapsed-time estimates. Finish each phase's tests with its code. Keep phases independently reviewable; split a large phase into cohesive commits as needed without changing the contract.

| Order | Phase | Relative size and principal risk | Commit boundary |
|---|---|---|---|
| 1 | Ledger-based language selection | Medium; completeness must not depend on projection or selected store tables. | A separate first fix commit, independent of checkbox enforcement. |
| 2 | Policy, adapters, metadata, and propagation | Large; authorization and every nested read must carry consistent policy. | Cohesive contracts/adapter/propagation commits with both engines kept in step; a separate commit for read-time rich-text visitor refresh and its tests. |
| 3 | Filters, sorts, and list text queries | Large; highest SQL review risk, including relation aliases, totals, and pagination. | Its own phase and dedicated query-semantics commit or commits. |
| 4 | Public search and both hook sets | Medium to large; stale hits and no-op reconciliation must be safe. | Search finishing and hook reconciliation can be separate commits. |
| 5 | Host preview and editor experience | Medium; selected language, publication metadata, and eight translation bundles. | Host behavior and copy changes with focused tests. |
| 6 | Cache parity with unpublish | Bounded; preserve existing invalidation behavior and preview isolation. | Focused parity verification and any necessary corrections. |
| 7 | Documentation, release notes, and final acceptance | Medium; deliberate API changes and limitations must match shipped behavior. | Documentation/release handoff after runtime verification. |

Phase 1 can be reviewed and released as an existing-bug fix on its own. Phases 2–6 together complete issue #102; intermediate commits do not justify declaring the public-delivery contract complete. Do not release a partial gate with uncorrected query paths or missing preview/search integration. No commits or releases are performed by this planning task.

Phase 1 may merge to `develop` after its independent review and tests. Build phases 2–6 together on one feature branch named `feat/<name>`, based on the phase 1 fix. Keep their commits off `develop` until the complete contract is implemented and phase 7's test report, manual acceptance, and documentation are complete and passing, except for the optional independent E1 bug fix described below. Include phase 7's release documentation in the same integration. If phase 1 or the independent E1 fix merges separately, update the feature branch to include the accepted fix. Do not merge or cherry-pick partial gating commits into the release branch: reconstruction could otherwise hide a translation while unrevised filters or sorts still expose its values through query behavior. An unavailable required check leaves the integration gate incomplete.

Explicit exclusions: stronger CDN/cluster/dependency invalidation guarantees, cache-fill race protection, blanket `no-store`, retroactive suppression of unrefreshed saved snapshots, snapshot maintenance tooling, partial frontend preview, a second preview toggle, new host UI for published/editorial reads, broader HTML content-language labeling, a translation-specific preview banner, singleton advertising, named fallback-chain configuration, and content-data migrations. Preserve existing snapshot and cache limitations in acceptance claims.

## Phase 1: correct ledger-based language selection first

Change fallback reconstruction in both `packages/db-postgres/src/modules/storage/storage-queries.ts` and the corresponding MySQL file. Choose the effective locale from the selected version's full completeness ledger before projection. Reuse batch ledger reads; do not load all content merely to prove completeness or introduce one metadata query per document.

Cover detail, list, and batch reconstruction, including relation/tree projections. Retain source-locale fallback and locale-agnostic behavior. This phase corrects an existing bug independently of `advertiseLocales`; it does not introduce checkbox eligibility, public `empty` changes, or new preview policy.

Add a conformance regression with a translated title in the text store and an untranslated source rich-text field in the JSON store. A title-only read, a full read, and a populated projection must choose the same source language. Include published-versus-latest version selection and a source different from the configured default. Use both adapters' conformance entry points and client projection tests.

Exit evidence: the regression fails against the old projected-row resolver and passes on both engines. Complete this as the first separate commit, suggested message `fix(i18n): resolve fallback completeness from the version ledger`.

## Phase 2: policy, storage gate, metadata, and read propagation

### Policy and authorization

Add `LocaleVisibility` and the `localeVisibility` option to core query contracts and SDK read types. Resolve it centrally: omitted or published status defaults to public; explicit `any` defaults to editorial. Dedicated edit/history/version reads retain editorial access. Keep the SDK's published status default and trusted adapter/internal editing defaults.

Require an authenticated actor with the existing resource read ability for editorial visibility, including published/editorial reads. Preserve `beforeRead`, `afterRead`, request-authority binding, security domains, recursion guards, and read budgets. Neither actor presence nor `_bypassBeforeRead` grants a locale-policy bypass. Reject public `locale: 'all'` for every collection. Support public `empty` by withholding all unavailable localized values while preserving non-localized values and normal reconstruction shapes.

Implement shared pure eligibility/candidate resolution in core. Preserve source and locale-agnostic exceptions; an advertised collection with an empty set authorizes no additional languages. Collections without `advertiseLocales` need no checkbox, but public `empty` still requires completeness. Test a synthetic intermediate fallback candidate without adding named-chain configuration.

### Both adapters and metadata

Thread the policy through ID/path/list/batch queries, read snapshots, and reconstruction. Compile `omit` eligibility into both count and data queries before pagination. Select the status version first; never search older versions for a more complete requested translation. Batch editorial and ledger reads, retaining phase 1's projection-independent selection.

Return `resolvedLocale: string | null` through `packages/client/src/response.ts`, types, and every reconstructed result surface. Implement all seven result types in the dedicated matrix below. Preserve raw `_availableVersionLocales` separately from `availableLocales`; public version metadata must come from the selected published version, never a newer draft or a union of ledgers. Current document-level source/checkbox metadata remains document-level.

### Propagation and rich-text boundary

Audit `packages/client/src/collection-handle.ts`, singleton delegation, `packages/core/src/services/populate.ts`, `richtext-populate.ts`, hook contexts, tree hydration, and rich-text callback types. Targets use their own definition, source, version ledger, and checkbox set. Keep populate's fallback semantics and existing authorization/status redaction. Audit path resolution when source differs from the current default without adding localized slugs.

Separate materialization and policy-sensitive hook caches by locale visibility. Test editorial-then-public and public-then-editorial reads sharing a logical context; also preserve cross-authority rejection and recursion detection. Review populate visited state without conflating cycle tracking with permission to reuse a materialized result.

### Separate commit: read-time rich-text visitor refresh

Implement E1's visitor changes and focused tests in their own commit. Suggested message: `fix(richtext): replace stale derived values during read-time population`. This corrects an existing stale-merge bug independently of issue #102. By default, keep it within phase 2 after policy propagation. Optionally, extract the existing-bug correction and its regression tests for cleared or redacted target fields, review and test it independently, and merge it to `develop` sooner. That independent fix must not depend on unfinished locale-policy changes; complete E1's locale-gating integration tests on the feature branch. This commit changes how an existing configured read-time refresh builds the returned relationship envelope, which contains copied target data such as a title or path. It does not repair the stored snapshot or add the future maintenance utility.

Configured rich-text read-time population must replace permitted derived values and clear old values absent from the current result. Visitors currently merge old envelopes, so merely forwarding the policy is insufficient. Test missing/denied targets and failed refresh behavior as well as source fallback. Preserve reference identity and authored link text/captions. A successful source fallback must replace the translated values; an absent permitted field must not retain its old copied value. This stale-merge risk is not unique to language withdrawal: changed or redacted target fields can also leave obsolete values behind.

The refresh changes only the response. It does not write a new parent version, and a later read follows the field's configured population behavior again. The future maintenance utility would inspect and repair persisted snapshots through normal versioning and publication rules; it remains outside this issue.

Keep snapshot-only fields unchanged on reads. Do not force population, rewrite saved versions, or add a repair job. In `packages/core/src/services/document-lifecycle/internals.ts`, explicitly preserve public visibility for automatic published save-time target reads despite an authenticated editor or preview session. The save-time regression must use fixture F3 below and assert the generated snapshot values, not only option forwarding.

Exit evidence: gate/auth tests, both adapter conformance suites, client integration propagation, all seven metadata results, and live/save-time/snapshot-only relationship tests pass. Remaining localized query mismatch is explicitly tracked by phase 3, not accepted as finished issue behavior.

## Phase 3: correct localized query semantics

This is a substantial correction to an existing mismatch: requested-locale SQL can filter or sort using values that fallback reconstruction does not display. Treat it as a distinct SQL workstream in both adapters, not an incidental addition to reconstruction.

1. Introduce an adapter-local SQL expression/helper for the operation's permitted effective locale using selected version, source locale, completeness, checkbox eligibility, and collection opt-in. The shipped chain has requested/source entries. Keep SQL decisions equivalent to the core resolver's tested rules.
2. Apply it to localized field predicates, ascending/descending field sorts, and the separate list text-query path. For public `empty` with an unavailable translation, localized values behave as absent; do not silently substitute source values. Preserve non-localized `all` values and existing operator/null semantics.
3. At each nested relation hop, evaluate the target with its own version, source, and collection policy. Preserve alias isolation, status view selection, and AND/OR grouping. Audit list text queries separately from relation field predicates so no branch retains ungated requested-locale matching.
4. Keep data and count queries consistent; `omit` must filter before counting and pagination. Preserve stable ordering, tie breakers, and null placement. Compare actual returned values, matching IDs, ordering, totals, and page boundaries across both engines.
5. Review representative SQL/query plans against existing indexed ledger/editorial keys. Assert batching and absence of per-document query fanout. Do not make a new benchmarking subsystem or schema migration a prerequisite; investigate demonstrated regressions.

Use distinctive withheld titles and source titles to prove that a public query cannot match the former and can match the latter under fallback. Cover non-advertised partial translations too: the old mismatch exists there independently of the checkbox. Test multiple document sources in one page, both relation opt-in directions, and nested scopes.

Exit evidence: Q1–Q4 below pass on both engines and reviewers can compare data/count SQL with the resolver contract. Suggested commit scope: `fix(query)`. This phase is required before calling the public gate complete.

## Phase 4: public search and both hook sets

Pin `indexDocument` and `reindex` to published/public/omit reads even on the system client. Index only source and eligible exact-locale projections; remove ineligible locale entries and never index source fallback under a translated locale.

In `packages/client/src/search.ts` and collection search, batch-check exact-locale eligibility for public provider hits even without hydration, a `beforeRead` hook, or when that hook is bypassed. Hydration must use `omit`. Drop the entire ineligible hit, including title/highlights. Cover both collection and zone search and do not create an editorial preview index.

Preserve provider order and use the documented restricted-result convention when eligibility restricts results: retained page-hit count, no unrestricted facets, and provider-offset pagination that can return short pages. Do not claim an exact filtered corpus total or paginate by the number of retained hits.

### Reference and template hook changes

Update both hook sets in the same phase:

- `apps/webapp/byline/collections/{docs,news,pages}/hooks.ts`.
- `packages/cli/src/templates/byline-examples/collections/docs/hooks.ts`.

Reindex when `requested.path || requested.availableLocales` is true. Do not gate solely on `changed.availableLocales`: an explicit reconciliation retry has no new change but still needs to repair indexing. Replace the template comment that says advertising does not affect indexed content. Keep the system client and existing post-commit hook invocation model.

The lifecycle already invokes `afterSystemFieldsChange` for a real mutation or an explicit no-op `reconcile: true` retry. A plain no-op does not invoke it. Do not add unconditional duplicate indexing outside this flow. On a failed post-commit effect, retain the committed locale set and audit event, report the existing committed-hook failure, and retry effects using the normal refreshed revision/precondition flow. No second content version, locale mutation, or audit event should be created on the no-op retry.

The app hooks retain their cache effects and existing behavior that starts indexing even if cache invalidation rejects. The CLI template has no reference-app cache dependency; add indexing/retry coverage without importing app cache modules or inventing a template cache subsystem.

| Hook case | Reference Docs/News/Pages | CLI Docs template |
|---|---|---|
| Locale enabled or disabled; path untouched | Existing locale cache invalidation plus one index reconciliation. | One index reconciliation. |
| Path only or path plus locales | Preserve existing path handling; one index reconciliation per invocation. | One index reconciliation per invocation. |
| No-op explicit retry; `requested.availableLocales: true`, both `changed` flags false, `reconciliation: true` | Rerun cache effects and indexing. | Rerun indexing. |
| Plain duplicate/reordered no-op without reconciliation | Lifecycle invokes no hook and performs no new audit write. | Same lifecycle behavior. |
| Effect fails after commit, then explicit retry succeeds | Failure reported; stored locale set remains; retry repairs effects without another mutation/audit/version. | Same indexing failure/retry behavior. |

Change the existing app hook test named “invalidates public locale surfaces without reindexing” to require reindexing. Exercise all three real hook modules. Add a runtime test of the actual CLI template hook with the server client mocked, not merely a source-text assertion. Pair these with core lifecycle no-op/failure tests, including a locale-only retry (existing coverage includes path retry).

Exit evidence: S1–S3 and H1–H3 pass, including intentionally stale search-provider hits and independent tests of both hook sets.

## Phase 5: host preview and editor experience

At preview-aware reads, derive version selection and locale visibility from verified cookie-plus-session state. Public-only representations remain published/public. Include document detail, lists, docs navigation, ancestors/breadcrumbs, and page-tree helpers. Keep the public client preview-blind and published/editorial review as an SDK capability with no new host UI.

Configure working host-owned locale-aware preview builders for Docs and News. Verify Pages against public prefix rules, including when content and admin defaults differ. The selected content locale must survive even when unchecked; do not select the preview URL from advertised links or canonical metadata. Preserve dirty-form navigation behavior; preview does not implicitly save.

Update preview indicator/tooltips, checkbox/source-row explanations, and immediate-save confirmation. Explain complete published-but-unchecked preview, saved-content scope, draft-only completeness, source availability, and immediate checkbox effects on an already published translation. Cover combined content/system-field saves without changing their existing two-request order.

Update all eight admin bundles (`en`, `fr`, `de`, `es`, `it`, `ko`, `th`, `zh-CN`) and run parity tests. Keep the public language menu restricted to public discovery; no preview-only switcher is required. Preserve the canonical correction at the baseline commit, and prevent preview draft metadata from supplying public alternates: use a public projection or suppress those alternates in preview as specified.

Exit evidence: P1–P4 and U1–U3 below, plus the manual walkthrough. P1 must test an unchecked complete translation on a published version with no newer draft.

## Phase 6: verify cache parity with unpublish

Verify the actual app locale-change hooks retain the same structural invalidation surfaces as unpublish: document details across all locale keys, applicable list/navigation caches, and sitemap surfaces. Matching negative entries must clear when enabling a locale. Preserve any already-configured dependent-collection hooks. Phase 4 owns the indexing changes; this phase verifies cache behavior rather than introducing a second mutation mechanism.

Use existing tag-cache tests and real app hooks to prime relevant entries, save a locale change, and read again. Compare the invalidation coverage of that locale change with `afterUnpublish`. Assert source fallback/eligible content on fresh reads after local invalidation. Preserve post-commit failure reporting and reconciliation retry behavior. Do not promise newly comprehensive invalidation of every dependent page.

Keep preview responses private and application-cache bypass active, including published/editorial review. Verify toggle-off/sign-out cannot reuse editorial cached objects. Preserve current public HTTP caching and configured edge session-cookie bypass; do not require a new CDN purge integration or impose blanket `no-store`.

Document the same limitations as unpublish: stale dependent caches, best-effort cluster propagation, old in-flight fills, and existing CDN responses. Cache-fill generation guards, global dependency tracking, stronger multi-node guarantees, and webhooks are separate work and not acceptance gates here. Snapshot maintenance is also separate; cache clearing cannot repair persisted snapshots.

Exit evidence: C1–C3 pass with the parity boundary stated in the test/verification report. A local test result must not be presented as proof of immediate worldwide withdrawal.

## Test fixtures and ownership

Use shared behavior fixtures through `packages/db-conformance`, executed by both adapters. Layer client/core/host tests where authorization or presentation belongs. The labels below are traceability IDs, not required test filenames; the implementing agent should record the final file/test names against each ID.

| Fixture | Required data |
|---|---|
| F1 | English source; complete Spanish unchecked; partial German; recognizable values per language; localized title in text and body in a different store such as rich-text JSON. Checked/unchecked and complete/incomplete variants. |
| F2 | A published version and newer draft with deliberately different completeness sets; include a draft-only complete locale and a newer incomplete Spanish draft over complete published Spanish. Also a published-only document with no draft. |
| F3 | Lifecycle default English, target collection with `advertiseLocales: true`, target source French, complete unchecked English translation on the published target. Authenticated editor saves a parent with a fresh relationship envelope. Save-time target read must produce French permitted values, not withheld English. |
| F4 | Collection without `advertiseLocales`, advertised collection with empty set, and locale-agnostic version; include partial content on the non-advertised collection. |
| F5 | Relations and tree nodes with differing sources/statuses; advertised parent to non-advertised target and the reverse; recursive rich-text relations and a snapshot-only field. |

### All seven resolved-locale result types

Run R1–R7 at adapter conformance and SDK shaping levels. Null is an explicit value, not an omitted property. Apply projection/target/history variations in M2 below rather than copying the entire matrix into every test suite. Client authorization assertions belong at the SDK boundary; direct adapter primitives remain trusted.

| ID | Result type | Required assertion |
|---|---|---|
| R1 | Localized `fallback` result | `resolvedLocale` is the selected permitted locale; test requested success and source fallback under public/editorial policy. |
| R2 | Localized `omit` result | Returned document reports requested locale; ineligible document returns null/is excluded, with no metadata result. |
| R3 | Public `empty`, requested locale eligible | Requested locale and eligible values, with no fallback. |
| R4 | Public `empty`, requested translation unavailable | `null`; localized values absent throughout nested structures; non-localized data and identity metadata retained. Test unchecked complete and checked incomplete. |
| R5 | Editorial `empty` on a localized version | Requested locale, including partial and entirely absent requested values; saved partial values remain accessible. |
| R6 | Authorized `locale: 'all'` | `null`, locale maps retained; anonymous/public attempts rejected by the client. |
| R7 | Locale-agnostic version | `null` and `_localeAgnostic: true` under every permitted missing-locale/read policy; public `all` remains invalid at the client. |

### Contract coverage matrix

| ID / phase | Required assertions | Primary test owner |
|---|---|---|
| L1 / 1 | Full/title-only/batch projection uses whole-version ledger; missing localized content in an unloaded store still causes fallback; no extra query per document. | Both adapter conformance suites; client read/populate integration. |
| G1 / 2 | F1 combinations of checked/unchecked and complete/incomplete under public fallback/omit/empty; source remains available when its checkbox is off; advertised empty set authorizes no additional locale. | Adapter conformance and client integration. |
| G2 / 2 | F4 opt-out collection retains no-checkbox eligibility; incomplete public empty suppressed; public all rejected regardless of opt-in; authorized exact/all preserved; singleton delegation stays compatible without adding advertising. | Conformance, client integration, type contracts. |
| G3 / 2 | Source differs from default; default changed after creation; ID/path/one/list resolve consistently; locale-agnostic behavior; synthetic intermediate withheld candidate skipped without new config. | Core resolver tests; adapter path/read conformance. |
| V1 / 1–2 | Version chosen before locale; draft-only translation stays public-invisible even when checked; newer incomplete draft falls back within itself; published/editorial can inspect older published translation; no published version yields no public result. | Client integration and adapter conformance. |
| V2 / 2, 4 | Publish/unpublish and scheduled publication do not bypass checkbox eligibility; completeness changes affect published delivery/index only when the corresponding version is selected. | Existing lifecycle/scheduling integration plus search orchestration tests. |
| A1 / 2 | Anonymous editorial denied even with published status; authenticated actor still needs read ability; public client cannot be elevated by cookies; authenticated/system published reads remain public by default. | Client auth/read unit and integration tests. |
| A2 / 2 | `_bypassBeforeRead` does not bypass eligibility; before/after hooks retain scoping/redaction; shared context partitions policies in both call orders; cross-authority reuse/recursive reads still fail as intended. | Core hook/populate/rich-text tests and client integration. |
| M1 / 2 | Public raw ledger includes complete unchecked published language but excludes newer draft-only completeness; no ledger union; document-level checkbox/source facts remain current; public fields independently gated. | Client integration and response shaping tests. |
| M2 / 2 | R1–R7 metadata survives full/projected/non-localized-only selection, per-target population, tree hydration, and authorized history/version reads; parent resolution does not overwrite target resolution; stubs need no invented value. | Conformance, client read/tree/rich-text/history integration. |
| T1 / 2 | Checked parent cannot authorize unchecked target; both collection opt-in directions; each target's source; recursive relations; missing/denied envelopes; no mixed fields/versions within one resolved document. | Core populate and client integration. |
| T2 / 2 | Withheld translations fall back in node titles/breadcrumbs/nav without breaking a published spine; unpublished or denied ancestor still hides/redacts descendants according to existing rules. | Client tree integration and app docs resolver tests. |
| E1 / 2 | Live rich-text refresh returns permitted values, clears stale generated fields absent from result, preserves authored content/reference IDs, and does not expose a withheld snapshot after a failed refresh. | Core rich-text and Lexical visitor tests; client integration. |
| E2 / 2 | F3 through `applyRichTextEmbed`: authenticated editor/preview context still yields published/public target read; assert actual generated French values and absence of withheld English, not only forwarded options. | Core lifecycle embed regression with client/adapter integration where needed. |
| E3 / 2 | Snapshot-only parent retains existing embedded values after target edit/locale withdrawal; no forced read-time refresh, storage rewrite, or maintenance job; live refresh does not mutate persisted parent version. | Rich-text/client integration. |
| Q1 / 3 | Localized filters and list text query match visible source under fallback, never withheld or incomplete requested values; under public empty, unavailable localized values behave as absent without matching source instead; source-specific choice across a mixed-source page; opt-out incomplete case too. | Both adapters via query conformance. |
| Q2 / 3 | Ascending/descending localized sorts use permitted values; empty results act as missing localized values; stable ties/null placement; non-localized values unaffected. | Both adapter sort/query conformance suites. |
| Q3 / 3 | Nested relation predicates and AND/OR groups use target-specific policy/source/status at every hop; aliases do not cross scopes; text query path separately audited. | Both adapter relation-filter conformance suites. |
| Q4 / 3 | Omit filter precedes count/LIMIT/OFFSET; full and projected lists agree; IDs, order, total, totalPages and successive pages stay consistent. | Both adapter conformance and client metadata tests. |
| S1 / 4 | Index/reindex uses published/public/omit under system actor; source and checked complete slices upsert, unchecked/incomplete slices remove; no fallback copies or draft index exposure. | Client search unit and integration tests. |
| S2 / 4 | Stale unchecked hit dropped entirely for collection/zone search, with and without hydration or beforeRead, including hook bypass; hydration cannot substitute source content to legitimize a translated hit. | Client search-auth/zone-search integration. |
| S3 / 4 | Retained-hit totals, omitted unrestricted facets, preserved ranking, and short provider-offset pages follow the documented restricted convention. | Client search finishing tests. |
| H1 / 4 | All five hook cases in the hook table exercised on real Docs/News/Pages modules and actual CLI Docs template; both enable and disable locale-only writes covered. | App hook tests and CLI runtime template-hook test. |
| H2 / 4 | Index failure after locale commit then explicit no-op retry reruns both hook sets appropriately; requested locale flag survives with changed false; no new audit/version/mutation; ordinary no-op skips effects. | Core lifecycle tests plus hook runtime tests. |
| H3 / 4, 6 | App starts indexing despite cache rejection; cache/index failure reported through existing committed-hook flow; path reconciliation and combined path/locale changes preserved; CLI remains app-independent. | Existing app hook, core lifecycle, and CLI boundary/runtime tests. |
| P1 / 5 | Complete Spanish on published version, unchecked, no newer draft: anonymous gets English, valid preview gets Spanish, preview-off signed-in viewer gets English. | Client/server-context integration and manual browser. |
| P2 / 5 | Cookie without session, expired session, sign-out, and preview-off revert to published/public; valid session with no ability denied; public client always public. | Request-context factory, host auth/preview tests and browser. |
| P3 / 5 | Latest incomplete translation falls back; exact editor exposes partial values; latest draft changes visible only to authorized preview; unsaved edits not shown or silently saved. | Client/host tests and browser. |
| P4 / 5 | Docs/News/Pages preview URLs preserve unchecked selected content locale and route prefixes even when admin language/default differs; generic builder contract unchanged. | Host resolver/app config tests and browser. |
| U1 / 5 | Public HTML/server payload/Markdown/sitemap/llms/available-language menus/alternates use public projection; preview does not add draft-only alternates; requested interface URL/language retained; baseline canonical/source behavior preserved. | App representation and locale-metadata tests. |
| U2 / 5 | Preview/source-row/save-confirmation copy matches saved/draft/public distinctions in all eight bundles; translation keys maintain parity. | Admin/i18n/host tests and browser. |
| U3 / 4–5 | Checkbox writes preserve version count/status and audit semantics; combined save writes system fields first; already-published translation can become eligible before content-save failure, while draft-only translation cannot. | Core lifecycle/client admin-save integration and browser. |
| C1 / 6 | Locale change invalidates the same existing detail/list/sitemap tag surfaces as unpublish; all locale variants and matching negative entries clear; preserve existing navigation/dependency tags. | App hook and real tag-cache tests. |
| C2 / 6 | Preview, including published/editorial reads, bypasses shared application cache and produces private responses; public/preview objects never cross on toggle or sign-out. | Cache wrapper/middleware/host tests and browser. |
| C3 / 6–7 | Existing public headers and invalidation limits retained; report parity without claiming guaranteed CDN/cluster/race/dependency withdrawal. No new snapshot suppression requirement. | Focused header regression and release/document review. |

Test file names must match each package's current Vitest configuration. Reuse existing client `client-read`, `client-before-read`, `client-after-read`, `client-document-tree`, `client-tree-before-read`, `client-richtext-populate`, `client-search-auth`, and `client-zone-search` integration suites where their fixtures fit. Reuse core `document-lifecycle.test.node.ts` and rich-text tests, app `byline/collections/docs/hooks.test.node.ts`, host preview resolver tests, and i18n parity tests. Proposed new CLI runtime hook tests must live in its discovered `src/**/*.test.node.ts` set. `packages/db-conformance` supplies suites to adapters and has no standalone test command.

## Manual browser acceptance

Use a running development host, an authenticated editor session, and a separate anonymous session. There is no automated browser suite; do not introduce Playwright. Record actual observations alongside P/U/C IDs.

Perform the walkthrough manually or through an available browser-control tool, such as Claude-in-Chrome. Record each scenario with the tested commit, environment/browser, fixture and initial saved state, session/preview state, URL, actions, expected result, and observed result. Attach the actual console PASS/FAIL output from assertions against the page or response. For visual checks, identify them explicitly as manual observations; a printed PASS label alone is not evidence. Use the following report template, replacing placeholders with observed results and verbatim console output:

```text
Scenario: <walkthrough step and contract IDs>
Commit / environment / browser: <values>
Fixture / session / URL: <initial state and location>
Actions: <repeatable steps>
Expected: <specific assertions>
Observed: <actual results, including manual visual observations>
Console evidence: <assertion executed and its verbatim PASS/FAIL output>
Result: <PASS, FAIL, or UNVERIFIED with reason>
```

Record failures and missing prerequisites rather than substituting expected output. Include request/response or screenshot evidence where it helps substantiate the observation, without copying session secrets into the report.

1. Start with F1's published English/Spanish document and no draft. Spanish is unchecked. The anonymous Spanish URL shows English with Spanish interface and source canonical behavior. The editor selects Spanish and clicks Preview; Spanish content and the preview indicator appear at the Spanish URL. The anonymous session remains English. This is P1, not a draft-only substitute.
2. Disable preview on that URL, then enable and sign out/expire the session. Subsequent origin reads return English. Repeat with an account lacking the collection read ability and verify no editorial access.
3. Add newer draft-only translated content and then an incomplete draft translation. Confirm saved preview/version behavior and source fallback; the exact editor still shows partial values. Exercise dirty-form preview navigation and verify no implicit save or claim of unsaved preview.
4. Enable and disable the checkbox with local detail/list/nav/sitemap caches primed. Check fresh delivery, public discovery, and search, including version/status/audit invariants. Verify a combined checkbox/content save against the immediate-write explanation. Report current cache limits; do not treat a stale deployment CDN hit as proof the origin gate failed.
5. Repeat destination checks for Docs, News, and Pages with a non-default content locale and different admin-interface locale. Check the source checkbox explanation, translated copy, public available-language menu, and preview alternates policy.
6. Inspect live-populated and snapshot-only rich-text relationships after a target locale change. The live response updates; the saved snapshot remains as documented. Confirm read-time refresh did not write a new parent version. Verify private preview headers and existing cache bypass.

If a browser/database/deployment check is unavailable, record it as unverified with the missing prerequisite. Unit assertions do not replace the required preview-language walkthrough.

## Phase 7: validation, documentation, and release handoff

Run targeted tests at each phase, then the final gates. Build packages before integration suites that import built workspace artifacts. The final test report must map R1–R7 and every contract ID to actual test names/results and browser observations; marking an ID covered solely because an option was forwarded is insufficient.

Focused commands include the following; use package filters and individual files while iterating rather than repeatedly rerunning all suites:

```sh
pnpm --filter @byline/core test
pnpm --filter @byline/client test
pnpm --filter @byline/host-tanstack-start test
pnpm --filter @byline/richtext-lexical test
pnpm --filter @byline/admin test
pnpm --filter @byline/i18n test
pnpm --filter @byline/webapp test
pnpm --filter @byline/cli test
pnpm build:packages
pnpm test:integration
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
```

Integration testing needs safe Postgres and MySQL test databases and package-local `.env.test` files. Keep shared suites serial (`maxWorkers: 1`, `isolate: false`, root concurrency 1). For one integration file, run `pnpm vitest run --mode=integration <test-file>` from its owning package. Both adapter conformance runs are mandatory; client integration currently uses Postgres. Preserve MySQL 8.0 CI compatibility when changing SQL.

Read current manifests and CI before the final run. The static gate order is:

```sh
pnpm byline:generate:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm knip:exports
pnpm test:scripts
git diff --check
```

`pnpm lint` modifies files; inspect its changes. Run root `pnpm test` once for final unit coverage and the integration command above once for final DB coverage; broaden/repeat only for new changes or failures. Complete remaining applicable CI jobs, including production build and CLI template/artifact checks. Review public export/type changes intentionally; do not bypass export auditing or hand-edit generated collection types. No schema change is expected to require collection regeneration beyond the read-only generation check.

Update content-locale, SDK/preview, query, search, caching, and admin docs after implementation. Release notes must explicitly state public `empty` suppression of incomplete additional translations on non-advertised collections and rejection of public `locale: 'all'` on every collection. Describe source availability, exposed published completeness metadata, `resolvedLocale`, one preview toggle, both hook sets' locale reconciliation, cache parity, and saved-snapshot limitations. Include all eight admin translations and remove stale comments claiming unchecked translations are intentionally publicly readable.

No schema or content-data migration is expected: verify both existing schemas and leave editorial choices intact. Rebuild the public search index and use existing operational cache-clear procedures at rollout; do not auto-check translations or claim stronger CDN withdrawal. Do not introduce snapshot repair or cache infrastructure as release prerequisites.

Deliver the completed implementation with phase/commit references, the traceable test report, manual observations, release notes, and any unverified environment checks. Issue #102 is ready only when all in-scope phases satisfy the settled specification. This document is the plan for that separate implementing agent, not an instruction to start implementation during the planning task.
