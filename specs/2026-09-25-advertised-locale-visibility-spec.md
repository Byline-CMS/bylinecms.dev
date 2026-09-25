---
title: "Advertised locale visibility — specification"
path: "advertised-locale-visibility-spec"
summary: "Proposed public translation visibility and authorized preview semantics for issue 102."
---

# Advertised locale visibility — specification

Companions:

- [Implementation plan](./2026-09-25-advertised-locale-visibility-plan.md) records the earlier implementation proposal; it will be aligned after specification review.
- [Content locales](../docs/08-internationalization/03-content-locales.md) describes the existing completeness ledger and locale controls.
- [Client SDK](../docs/05-reading-and-delivery/01-client-sdk.md) describes version selection, authorization, and preview.
- [Caching](../docs/05-reading-and-delivery/06-caching.md) describes the current application and HTTP cache boundaries.
- [Indexing and reindexing](../docs/06-search/02-indexing-and-reindexing.md) describes public search projections.

Date: 2026-09-25. Status: proposed specification for review before implementation. Grounded in commit `1ac9287a` and [issue #102](https://github.com/Byline-CMS/bylinecms.dev/issues/102). This task changes no runtime behavior. Proposed API names below are design decisions for the implementing agent, not existing exports.

This specification incorporates the comparison with the independent implementing agent's analysis and the user's decisions to accept cache parity with unpublish and potentially stale saved rich-text snapshots. It takes precedence over the earlier implementation plan where they differ, including public `empty` reads, resolved-locale metadata, caching, and snapshot requirements. The plan has not been revised during this specification review.

## Purpose and intended contract

For public content resolution in a collection with `advertiseLocales: true`, a complete but unchecked additional translation behaves like a translation that does not exist. The source-language exception is defined below. This rule governs delivery of translated content; the stored completeness and editorial metadata remain separate facts.

An editor's saved language checkbox authorizes public delivery of that translation. A translation that is complete but unchecked is ready for editorial review and remains unavailable to public content reads. This specification treats that as the intended meaning of advertised languages; it does not introduce a compatibility mode for the existing exposure of unchecked translations.

For a collection with `advertiseLocales: true`, public delivery of an additional language requires both editorial authorization and completeness on the selected published version. The source-language document remains available under the existing publication and authorization rules, even if the source checkbox is off. Checking a language does not publish a draft, complete a translation, or grant a reader any additional collection permissions.

This eligibility rule applies to fresh document and live relationship reads. Existing delivery caches have the same withdrawal limitations as unpublish, and previously saved rich-text relationship snapshots can retain copied values. The cache and snapshot sections below define these accepted boundaries; the checkbox does not promise immediate removal of every previously served or embedded copy.

The reference example is an English-source document with complete Spanish content and an unchecked Spanish checkbox:

| Request | Required result |
|---|---|
| Ordinary `/es/example` | English source content with the Spanish interface and URL retained. |
| Authorized preview of `/es/example` | Spanish content from the latest saved version, when that version is complete in Spanish. |
| Ordinary `/es/example` after checking Spanish and saving | Spanish content, if complete on the current published version. |
| Ordinary `/es/example` after unchecking Spanish and saving | English source content again. |
| Public exact-locale read with `onMissingLocale: 'omit'`, Spanish unchecked | No result for this document. |
| Public exact-locale read with `onMissingLocale: 'empty'`, Spanish unchecked | The document with localized values absent and non-localized values retained. |

There is no redirect to the English interface merely because English content was selected. The existing canonical/hreflang policy remains distinct from interface routing.

## Vocabulary and independent decisions

- **Requested locale** is the content preference supplied to the read. The host may derive it from the interface URL; interface-only languages still map through the host's configured content-locale policy.
- **Source locale** is the document's durable `sourceLocale`, independent of the installation's current default.
- **Resolved locale** is the content locale selected for reconstruction on this read, exposed as the proposed `resolvedLocale` metadata. It can differ from the requested locale and is null when no single content locale is selected.
- **Version selection** chooses the latest published version (`status: 'published'`) or latest saved version regardless of status (`status: 'any'`). It selects one whole version, not a separate version for each language.
- **Completeness** is the stored, version-specific `_availableVersionLocales` ledger. A localized version is complete in a language when that language covers the localized field paths present in the source. It is structural coverage, not a translation-quality assessment.
- **Editorial authorization** is the saved, document-level `availableLocales` set. The editor's unsaved form state has no public effect.
- **Locale visibility** determines whether language selection must honor editorial authorization or may inspect withheld translations.
- **Missing-locale policy** determines whether to fall back, omit the document, or return an exact-locale result with unavailable localized values absent after those decisions. Editorial exact-locale reads can retain partial translations.

Keep `availableLocales` and `_availableVersionLocales` separate. Neither should be overwritten with their intersection. The editor needs to distinguish complete/unchecked from checked/incomplete.

For an advertised collection, a localized version `V`, and requested language `L`, public eligibility is:

```text
eligible(D, V, L) =
  L == D.sourceLocale
  OR (L is complete on V AND L is in D.availableLocales)
```

Apply publication and authorization before this rule. Locale-agnostic versions, identified by the ledger's `all` marker, retain their existing ability to render everywhere. Collections without `advertiseLocales: true` retain completeness-based language resolution: they have no checkbox authorizing translations. Singletons currently prohibit `advertiseLocales`; do not add that feature as part of this issue. Relations from either kind of resource to an advertised collection must honor the target's own policy.

An empty or absent editorial set authorizes no additional translations. Do not automatically fill it from the completeness ledger or from currently populated languages. The source exception is implicit and requires no stored checkbox or migration.

## Preview design

### One toggle, two effects

Keep the existing session-level preview toggle. Authorized frontend preview selects the latest saved version and permits complete but unchecked translations. The same URL opened by an ordinary visitor still receives public content. Enabling preview never changes `availableLocales` or status, and no new cookie, shared secret, or public query-string bypass is required.

These effects must remain separate internally. Published does not mean publicly authorized in every language, and an authenticated actor is not automatically asking to preview. In particular, a system actor building the public search index must still receive the public language policy.

Recommended SDK/adapter option: `localeVisibility: 'public' | 'editorial'`.

Retain an explicit option so an authorized caller can review withheld translations on the published version even when a newer draft exists. The name `editorial` includes exact editing reads of partial translations; it does not imply that every permitted read returns complete content. Published-plus-editorial reads are an SDK capability in this issue and require no new host UI or caller. A second frontend preview switch is outside scope.

| Read | Version selection | Locale visibility | Result |
|---|---|---|---|
| Public client; viewer with preview off | `published` | `public` | Checked, complete translations or source fallback. |
| Viewer with valid preview session | `any` | `editorial` | Latest saved complete translation, checked or unchecked. |
| Explicit authorized review of the published version | `published` | `editorial` | Complete translation on the published version, checked or unchecked. |
| Admin edit/history/version operations | Existing editorial version selection | `editorial` | Exact editing/history behavior, including partial translations. |
| Public indexing and public representations | `published` | `public` | Same language eligibility as public delivery, even with a system actor. |

For ordinary SDK reads, default locale visibility to `public` when status is omitted or `published`, and to `editorial` when status is explicitly `any`. Preserve the SDK's existing published status default. Preview-aware host functions should pass both decisions explicitly from the verified preview state. This keeps existing published-only host functions public even when the viewer client resolves an admin actor.

An explicit `editorial` read requires an authenticated actor with the existing resource read ability, including when status is `published`. Extend enforcement so an anonymous caller cannot request published/editorial content. The public client always resolves an anonymous context; cookies cannot elevate it. Preview requires the existing valid admin session plus preview cookie, followed by the ordinary collection ability and `beforeRead` checks. A user without the read ability is denied, not silently granted access because the preview toggle is on.

The new option is server-side read intent, not authority. Do not trust it as an unauthenticated transport parameter. `_bypassBeforeRead` bypasses that hook only; it must not bypass locale visibility. Carry the resolved policy through nested reads, relation populate, rich-text populate, and tree hydration. Include it in any materialization or hook cache whose result can vary by policy. Reusing a shared read context must not return an editorial object to a subsequent public read.

### Preview cases that must be understood before implementation

1. **Complete published Spanish, unchecked; no newer draft.** Preview must show Spanish even though the selected version already has published status. A test that only covers drafts misses this case.
2. **Spanish exists only on a newer draft.** Public reads select the older published version and fall back to its source. Preview selects the newer version and shows Spanish when complete. Checking Spanish alone cannot expose draft-only content.
3. **A newer draft has incomplete Spanish; an older published version has complete Spanish.** Ordinary preview selects the latest version and falls back to that version's source. It must not quietly substitute Spanish from an older version or mix fields across versions. An authorized published/editorial read can inspect the older published Spanish translation explicitly; a second frontend mode selector is not required by this issue.
4. **Spanish is partial on the selected version.** Frontend preview with `fallback` shows source content. The editor's exact `empty` view continues to show the partial translation. Preview does not waive completeness, and incomplete frontend rendering is outside scope.
5. **The form has unsaved translations or checkbox changes.** Preview shows the saved server state. The existing preview action does not submit the form. Preserve unsaved-change protections and explain this behavior; do not silently save or promise live unsaved preview.
6. **Preview is disabled, the editor signs out, or the session expires.** Subsequent reads return to published/public behavior; a stale preview cookie grants nothing. Revalidate frontend loaders so an unchecked translation is replaced by its source fallback.

### Editor experience

The per-document preview link must carry the selected **content** locale, regardless of whether it is checked. Do not choose the preview destination from `advertisedLocalesFor`, the canonical URL, or the admin-interface locale. The Docs and News admin configurations currently leave locale-aware preview builders commented out; their generic path fallback drops the selected locale. Supply working host-owned builders and test Pages against the public locale-prefix rules too.

Keep one visible preview indicator and describe it as showing saved drafts and withheld translations. “Drafts are visible” alone is inaccurate for case 1. Public language menus and hreflang remain public discovery surfaces; do not add unchecked languages to them to make preview reachable. The editor's content-locale selector plus preview link is the required way to reach an unchecked translation.

Update the checkbox description and immediate-save confirmation to explain the delivery consequence. The source row must explicitly say that the source remains available while published; unchecking that row only removes explicit advertising. Retain that source advertising control rather than silently changing stored selections. A complete green row is permission to enable a translation, not proof that the currently published version is complete in that language.

Apply the admin copy changes to all eight bundled translations: `en`, `fr`, `de`, `es`, `it`, `ko`, `th`, and `zh-CN`. Preserve translation-key parity and verify it with the existing bundle parity tests; an English-only copy update does not satisfy this requirement.

## Read semantics and enforcement

### Fallback and exact reads

| Policy | Public visibility | Editorial visibility |
|---|---|---|
| `fallback` | Select the first eligible language in the chain, ending at this document's source. | Select the first complete language in the chain, ending at this document's source. Ignore checkboxes. |
| `omit` | Return null/exclude the row unless the requested language is publicly eligible. | Return null/exclude the row unless the requested language is structurally available. |
| `empty` | Return the requested locale if publicly eligible; otherwise return the document with all localized values absent and non-localized values retained. Never fall back. | Preserve exact-locale editing behavior, including any saved partial translation. |
| `locale: 'all'` | Reject for every collection, including those without `advertiseLocales`; do not return all translation maps publicly. | Preserve authorized multi-locale editing/history behavior. |

Public `empty` is a supported read policy. For an additional language, an unchecked translation in an advertised collection or an incomplete translation contributes no localized values, even when some translated fields exist. Collections without `advertiseLocales` require completeness but no checkbox. Preserve the ordinary reconstruction shape for absent values, including nested fields, and preserve non-localized values and structural identity metadata; do not fabricate empty strings or expose stored localized fragments. Determine eligibility before projection, hooks, and localized query evaluation so an unavailable translation cannot leak through a title-only read or a filter. The source and locale-agnostic exceptions continue to apply.

Two deliberate public-read contract changes extend beyond collections that opt into advertised languages. Public `empty` now suppresses incomplete additional translations even in collections without `advertiseLocales`, where exact reads could previously expose saved partial values. Public `locale: 'all'` is rejected for every collection regardless of that setting. Document both changes explicitly in the release notes and SDK documentation, and regression-test a collection without `advertiseLocales`. Authorized editorial `empty` and `all` behavior remains available. These are intentional contract changes, not incidental effects of the checkbox gate.

Use a clear validation error for public `locale: 'all'`, and an authorization error for an anonymous editorial request. Validate these options before adapter work. Internal direct adapter reads remain trusted primitives; retain their existing `any`/exact defaults where required by lifecycle operations, but honor an explicitly supplied public policy. Do not make internal write machinery accidentally reconstruct public fallback content as editable source data.

The shipped chain is `[requested, source]`. Intermediate configured fallback languages are not currently implemented. Do not add a fallback configuration feature here. Structure the resolver so every candidate must satisfy the selected policy, and test a pure candidate list such as `[es-MX, es, en]` to prove a withheld intermediate language cannot be selected if chains are extended later.

Choose the effective language from the full selected version's ledger before restoring fields. This deliberately corrects an existing bug that predates issue #102: fallback reconstruction recomputes completeness from loaded rows, so selected store types can make a partial translation appear complete in a projected list. A title-only projection must make the same language decision as a full read, including when the missing translation is in a different store table. The ledger-based selection correction is in scope independently of whether the collection uses advertised languages.

Do not select “the newest version that has an eligible Spanish translation.” Select the version using the existing status rule first. If that version does not qualify in Spanish, apply the missing-locale policy to that version.

### Resolved-locale metadata

Include `resolvedLocale: string | null` on reconstructed SDK document results in this issue. It records the resolver's decision for that document and selected version. Hosts must not have to infer that decision from the URL, checkbox set, or completeness ledger. It describes the selected reconstruction locale, not a linguistic guarantee about every field or a statement that the translation is publicly released.

| Read result | `resolvedLocale` |
|---|---|
| Localized document returned with `fallback` | The selected eligible locale, including the source when fallback occurs. |
| Localized document returned with `omit` | The requested locale; an omitted document has no result metadata. |
| Public `empty`, requested locale eligible | The requested locale. |
| Public `empty`, requested translation unavailable | `null`, because localized values are withheld and no fallback locale is selected. |
| Editorial `empty` on a localized version | The requested locale, identifying the exact reconstruction context even when its values are partial or absent. |
| Authorized `locale: 'all'` | `null`, because the result contains locale maps rather than a single selected locale. |
| Locale-agnostic version under any permitted read | `null`; retain `_localeAgnostic: true` to identify this case. |

Resolve this metadata from the whole version before field projection. Selecting only non-localized fields must not change a localized document's `resolvedLocale`. Each reconstructed populated target, tree node, and historical document result carries its own resolution; a parent result does not describe the language of its related documents. Preserve this metadata through response shaping. Raw storage primitives and unresolved relation stubs need not invent it.

For example, the same Spanish URL can return `resolvedLocale: 'en'` publicly and `resolvedLocale: 'es'` in authorized preview. Broader HTML language labeling and a translation-specific preview banner remain separate presentation work. This issue requires truthful read metadata and the general preview indicator described above.

### Public locale metadata

Public read results may expose the raw `_availableVersionLocales` completeness ledger alongside the document-level `availableLocales` set. Do not replace either with their intersection or conceal a complete locale solely because its checkbox is off. It is acceptable for a visitor to learn that an unchecked translation is structurally complete; this issue controls delivery of translated values, not secrecy about translation activity.

Version-specific metadata must describe the same selected version as the returned content. For public delivery, `_availableVersionLocales`, `_localeAgnostic`, and `resolvedLocale` must be derived from the selected published version, never from a newer draft or from a union of version ledgers. In contrast, `availableLocales` and `sourceLocale` are current document-level facts and are not frozen publication snapshots. A locale checked while editing a draft may therefore appear in `availableLocales` while remaining absent from the published `_availableVersionLocales` and unavailable for public delivery.

Authorized preview and historical reads may expose their own selected version's metadata, but a host must not reuse that metadata as the public published projection for discovery. Require a regression fixture where the published version has a complete unchecked language and a newer draft adds another complete language: the public ledger may expose the first language but must not expose draft-only completeness. Verify that public fields and resolution still honor the checkbox independently of the exposed ledger.

### Where enforcement belongs

Core owns policy types, authorization rules, and pure locale decisions. The client resolves caller intent and threads it through every read path. Both Postgres and MySQL implement the same policy in their storage queries. A host-only filter or `afterRead` redaction is insufficient: it cannot safely repair pagination, filtering, sort order, population, or values already handed to hooks.

Aligning localized filters, sorts, and list text queries with the effective locale is a substantial query-semantics correction, not only propagation of a new option. The current SQL can match or order by requested-locale values while fallback restoration renders source-language content; this mismatch predates issue #102. Correcting it is deliberately in scope because an unchecked translation must not remain observable through query matches or ordering. The implementation plan must size and review this work separately from ledger-based reconstruction and the eligibility gate, including both adapters, count/pagination behavior, and nested relation scopes. Audit the list text query path explicitly as well as field predicates and sorts; correcting one SQL path must not leave another using ungated requested-locale values.

- Detail reads by ID/path and `find`/`findOne` must use the same decision.
- `omit` eligibility must be in SQL before counting, sorting, and pagination; do not discard rows after pagination.
- Field filters, list text queries, field sorts, and nested relation predicates must use the language permitted for each relevant document. Withheld values must not match a public query or influence ordering while the response displays source text. For public fallback reads, use each document's effective locale; for exact eligible reads, use the requested locale. Preserve non-localized `all` values.
- Tree node titles, ancestors, breadcrumbs, and relation targets must be restored under the same policy. A withheld translation falls back; it does not remove the document's published source node or break an otherwise published ancestor chain. Existing status/authorization-based tree redaction remains intact.
- Each populated target resolves eligibility using its own source locale, completeness ledger, and checkbox set. A parent's checked Spanish checkbox does not authorize its target's Spanish translation. Preserve populate's fallback policy and existing missing/denied relation envelopes.
- Rich-text relation reads must carry the policy through recursive batches and cache keys. Configured read-time population must replace target-derived values with the current permitted result and clear stale derived values that result no longer supplies. A failed refresh must not return a withheld snapshot as though it were a successful live resolution; preserve existing unresolved/error handling without exposing the stale target values. Saved snapshots on fields without read-time population follow the separate boundary below.
- Preserve admin edit, history, revision, and raw multi-locale paths as editorial operations. Audit shared helpers and singleton delegation without adding singleton advertising controls.

The current path lookup initially uses requested/default locales before the source is known. Do not expand this issue into localized-slug design, but regression-test a document whose source differs from the current default. Any required lookup correction must use the document's source path and must not route through a withheld translated slug to bypass the content gate.

### Rich-text snapshot boundary

A rich-text relationship snapshot is target-derived data copied into the parent document when it is saved, such as a linked document's title. Fields configured to embed relationships on save can retain that copy without reading the target again on every request. This is stored parent content, not an application or CDN cache entry.

| Relationship behavior | Contract for this issue |
|---|---|
| Configured read-time population | Read the target under the current operation's language policy and refresh the returned relationship data. Public reads must not retain stale translated values that the permitted target result withholds. |
| Automatic save-time target reads | Honor the resolved read policy. The existing published target reads use public locale visibility, even with an authenticated actor; saving a parent must not exempt these reads from the gate. |
| Saved snapshot without read-time population | Preserve the stored copy. A later target edit, unpublish, deletion, or language withdrawal does not automatically rewrite or suppress it through this issue. |
| Independently authored link text, captions, or other parent content | Preserve the parent's content and normal workflow; it is not a live target projection. |

Accepted limitation: an older embedded title or other copied value may still be present in a fresh parent response after the target translation becomes unavailable. This includes serialized relationship data even when the renderer does not visibly display it. Clearing delivery caches does not update that stored copy, and a parent's `resolvedLocale` does not establish the freshness or language of every embedded snapshot. Public representations of the parent inherit this same limitation.

Do not force read-time population on snapshot-only fields, suppress previously copied fragments globally, or mutate stored parent versions when a target language is unchecked. Where read-time population is configured, refreshing the response does not itself repair the persisted snapshot. This distinction applies to snapshot freshness generally, not only to language withdrawal.

The intended follow-up is a maintenance capability that can run manually or on a schedule. It should inspect stored rich-text relationship snapshots, report stale or unavailable targets and proposed changes, and offer a repair operation. Its scope should cover target content/status changes as well as language availability. Repair should distinguish generated relationship data from editor-authored content, show a reviewable difference, and use normal versioning and publication rules rather than silently rewriting immutable versions or bypassing editorial approval. Reporting and repair do not provide an immediate withdrawal guarantee.

Designing or implementing this maintenance capability is separate work and is not a completion requirement for issue #102. Document the limitation now and test that live population honors the gate while snapshot-only fields preserve their configured behavior.

Also require a regression through `applyRichTextEmbed` in `packages/core/src/services/document-lifecycle/internals.ts`: an authenticated editor saving a parent must still cause its published save-time target read to use public locale visibility. Use a target whose source differs from the lifecycle's default locale, with a complete but unchecked translation in that default locale. Assert both the effective read policy and the freshly generated snapshot's permitted source-language values, so the test cannot pass merely because the requested locale happened to be the target's source. The editor's authentication or active preview must not elevate this automatic published read to editorial visibility.

### Public representations and discovery

HTML, server-function payloads, Markdown exports, feeds where present, and other document-backed public outputs must all use the public policy. Preview-aware HTML explicitly opts into editorial visibility. Markdown, sitemap, and `llms.txt` remain preview-blind. Their fresh list/detail reads must not select unchecked translated fields through an alternate representation. The documented existing-cache and saved-snapshot limitations apply consistently to these outputs.

The public advertised set remains `availableLocales ∩ _availableVersionLocales` for the public version. The source remains reachable and canonical-eligible independently. Preserve the canonical/hreflang correction in `1ac9287a`; do not add unchecked preview locales to public discovery. Preview-derived draft completeness must not be presented as evidence of published availability. Keep preview responses private; use a public metadata projection if public alternates are rendered in preview, or suppress those alternates there.

Factual content-language labeling across HTML and accessibility surfaces is the related follow-up identified by the issue. The `resolvedLocale` read metadata is in scope now; applying it to those presentation surfaces and adding a translation-specific preview banner remain follow-up work.

## Search, writes, and caches

### Search is public delivery

`indexDocument` and `reindex` must explicitly use published/public reads with `onMissingLocale: 'omit'`, even on the system client. Index the source and eligible translations only; never index fallback source copies as Spanish results. Checking/unchecking a locale must reconcile its index slices as well as caches. The current Docs, News, and Pages `afterSystemFieldsChange` hooks only trigger indexing when `requested.path` is true; include locale changes and reconciliation retries. Apply the same contract to the shipped CLI Docs hook template at `packages/cli/src/templates/byline-examples/collections/docs/hooks.ts` so newly generated projects reconcile locale changes too.

Protect search against stale index entries. The current unhydrated/no-`beforeRead` fast path returns provider titles and highlights without a content eligibility read. Public hit finalization must batch-check exact-locale public eligibility even without hydration or a hook. Hydration must use `omit`, not source fallback: an English document attached to an old Spanish hit does not make that hit safe. Drop the entire ineligible hit, including title and snippet. Apply this to collection and zone search.

When eligibility checking restricts provider results, do not return unrestricted provider totals or facets. Follow the existing response convention documented in [Authorization after ranking](../docs/06-search/03-search-api.md#authorization-after-ranking): retained-hit count, no unrestricted facets, provider-offset pagination that may produce short pages. Do not pretend the retained page length is an exact total over the entire filtered index. Reindexing restores index consistency; read-time checks protect the interval before it finishes or if a hook fails.

The public search index is not a preview index. It need not discover unpublished or unchecked translations for editors; the direct preview link supplies that workflow. Do not start indexing withheld content to support preview.

### Saved checkbox changes

Keep the existing non-versioned `updateDocumentSystemFields` transaction, audit event, optimistic-concurrency behavior, and post-commit reconciliation mechanism. Changing a checkbox mints no content version and resets no workflow status. The public rule consults the current document-level set together with the selected version's frozen completeness ledger.

For a combined content/checkbox save, the admin sends one request, and the server writes the checkbox change and then the new content version inside one guarded transaction: both commit, or neither does. Once the save commits, checking Spanish exposes the **already published** Spanish content immediately, while the accompanying content edits enter the version workflow. If Spanish exists only in the draft, it remains withheld from public delivery until a complete version is published. A failed save applies neither change. That is distinct from `ERR_DOCUMENT_HOOK_COMMITTED`, which reports that a post-commit hook failed after both writes had committed. Explain these cases in the confirmation copy and tests. Do not stage the checkbox until publication or reorder the save workflow in this issue.

:::note[Superseded premise, corrected 2026-09-25]
The review draft of this section assumed the system-field write and the content write ran in separate transactions, so that a checked translation could stay exposed after a failed content save. Implementation found the combined save has been one request and one guarded transaction since commit `d78548a5`. That premise is superseded; the paragraph above states the actual behaviour.
:::

### Cache parity with unpublish

The agreed scope is the same cache invalidation guarantee as unpublish. Fresh public content reads that reach the read pipeline after a saved checkbox change must use the new eligibility rule. Locale changes must invoke the existing structural-change invalidation and search-reconciliation mechanisms, including reconciliation retries. This requirement does not promise that every cached response changes at the instant the database write commits.

The reference application's system-field hooks already invalidate document details and the applicable list/sitemap surfaces on locale changes. Detail tags cover all locale keys. Preserve and test that behavior, including clearing matching negative entries when a language becomes eligible, and add the missing locale-change search reconciliation. Use the existing post-commit error reporting and retry flow; a retry must rerun the applicable effects without another audit mutation. Preserve any existing dependent-collection invalidation hooks.

Accepted limitations are the same ones present for unpublish: dependent cached pages may remain stale where no dependency invalidation exists; an in-flight fill may outlive an invalidation; cluster invalidation is best-effort; and an edge may serve an already cached response. The current HTTP policy includes `s-maxage=60, stale-while-revalidate=86400`. Application invalidation does not purge those edge responses. A fresh target read is therefore correctly gated even while an older cached representation remains observable. State this limitation in the documentation and release notes without presenting locale withdrawal as stronger than unpublish.

Reliable dependency invalidation, cache-fill race protection, guaranteed multi-server propagation, CDN purging, and webhook or other enterprise invalidation strategies are separate work. They are not completion requirements for issue #102. Do not impose a new blanket `no-store` policy or redesign the cache infrastructure as part of this change. Use the existing operational cache-clearing mechanisms on rollout and rebuild the public search index; this refresh does not establish a new ongoing global withdrawal guarantee.

Authorized preview continues to bypass application shared caches, including published/editorial review. Preserve the existing session-cookie bypass at configured edges and private preview responses; the preview cookie alone is not authority. Verify that preview on/off and sign-out retain the current cache separation. The accepted public-cache limitations do not authorize caching editorial preview content for ordinary visitors.

## Data and scope boundaries

No schema or content-data migration is expected. Both adapters already persist source locale, version completeness, and editorial locales in separate tables. The implementing agent must verify this against both schemas and avoid rewriting locale choices. Release work includes clearing derived caches and rebuilding search indexes; those are derived-data refreshes, not content migrations.

Do not add a legacy behavior switch, downstream application migration program, per-locale workflow statuses, versioned checkbox approval, partial frontend preview, a new preview token system, singleton locale advertising, or named fallback-chain configuration. Stronger general cache invalidation guarantees and snapshot reporting/repair tooling are also outside this issue. Update the reference application where needed to demonstrate the upstream contract, and describe the correction and accepted limitations in developer docs and release notes.

## Review decisions and completion criteria

This proposal makes the following choices explicit: one preview toggle; distinct internal version and language visibility policies; source availability independent of its checkbox; editorial gating limited to collections that expose the control; frontend preview restricted to complete saved translations; public `empty` results that withhold unavailable localized values; all-locale views restricted to editorial reads; truthful `resolvedLocale` metadata; cache parity with unpublish; and preservation of potentially stale saved snapshots where read-time population is not configured.

Implementation is complete only when both adapters and the client enforce the matrices above, the editor can preview an unchecked published translation in the selected language, fresh public search and alternative representations apply the same eligibility policy, and checkbox saves reconcile delivery/discovery without creating a version. The documented public-cache and saved-snapshot exceptions limit the delivery guarantee. Regression coverage must include public `empty` suppression for unchecked and incomplete translations, the deliberate public-read restrictions in non-advertised collections, preservation of editorial partial reads, `resolvedLocale` across fallback/exact/projected/populated/historical/multi-locale/locale-agnostic results, public ledger metadata from the selected published version only, effective-locale query semantics, cache invalidation parity with unpublish, the distinction between live relationship refresh and preserved snapshots, and public visibility for save-time embeds under an authenticated editor. All eight admin translation bundles must pass parity checks, and release notes must identify the two broader read-contract changes. The companion plan's tests and manual browser walkthrough must be aligned with this specification before implementation begins. No runtime implementation or GitHub publication is part of this analysis task.
