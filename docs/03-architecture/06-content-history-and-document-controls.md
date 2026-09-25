---
title: "Content history and document controls"
path: "architecture-content-history-and-controls"
summary: "Why Byline separates immutable content from current document controls, how source locales preserve interpretation, and where historical replay and coordinated publication need further design."
---

# Content history and document controls

Companions:
- [Document Storage](./01-document-storage.md) describes version storage and reconstruction.
- [Auditability](../07-auth-and-security/02-auditability.md) describes the records for content authorship and mutable operations.
- [Administering content locales](../08-internationalization/04-administering-locales.md) explains default-locale changes and explicit re-anchoring.
- [Content locales](../08-internationalization/03-content-locales.md) defines completeness, fallback, and advertised languages.

Byline keeps immutable content history alongside audited mutable workflow and document controls. Read this when you are evaluating that boundary, deciding where a new attribute belongs, or determining what a historical version can reproduce.

This records the architectural rationale reviewed on 2026-09-25. The public language gate agreed for issue #102 is planned behavior, identified separately below; this document does not claim that gate or the future capabilities are already implemented.

## What belongs to a version

A **logical document** has a stable identity across edits. A **content version** records one saved set of user-defined field values. A **document control** governs the document across those versions, such as its current path or advertised languages. A **derived fact** describes stored content rather than an editor's intent; the completeness ledger records which locales cover the source version's localized field paths.

When you place an attribute in the model, ask what it describes and when its changes should take effect. Calling something “metadata” does not determine whether it should be versioned.

| State | Current ownership | Reason |
|---|---|---|
| User-defined field values | Immutable content version | Editors must be able to compare and recover saved content. |
| `_availableVersionLocales` completeness ledger | Derived per version when written | Completeness describes that version's content, independently of publication or checkbox decisions. |
| Workflow `status` | Mutable lifecycle metadata on a version | Publishing approves an existing version; it does not require copying its content. |
| `path` | Logical document | A routing change persists across subsequent edits and content restores. |
| `availableLocales` | Logical document | The editor's language choices persist across content revisions. |
| Tree parent and sibling order | Logical document | Placement changes independently of content revisions. |
| `sourceLocale` | Logical document, stable in ordinary editing | Existing content retains its interpretation when the installation default changes. Explicit re-anchoring is an exceptional operation. |

Status belongs to a version but is not an immutable record of that version's workflow history. Status transitions change its row in place; publishing also archives previous published versions. Audit records provide evidence of those operations. The distinction between immutable content and mutable lifecycle state is part of the model, not an exception that callers should overlook.

## Why retain current controls when restoring content

Suppose an editor withdraws a language today and restores an older article tomorrow. Restoring the article should not silently re-enable the withdrawn language. Similarly, recovering a paragraph should not reinstate an obsolete URL or move the document back to its former parent.

Byline therefore restores content into a new version while retaining current document controls. Restore uses the collection's default workflow status; that normally produces a draft, but a published-default workflow can publish the restored content immediately. The [Client SDK](../05-reading-and-delivery/01-client-sdk.md) describes restore as an editorial operation, not a replay of an entire past site state.

Versioning every control would support a different workflow, in which routing and language decisions are staged with content. It would also require explicit rules for withdrawing a language across versions, restoring old controls, and separating urgent routing changes from unfinished drafts. That is a possible product design, but it is not automatically more consistent than the current one.

The accepted direction for [issue #102](https://github.com/Byline-CMS/bylinecms.dev/issues/102) treats a checked language as continuing permission to deliver that document in the language when the selected published version supports it. It is not approval of one particular translated revision. Later content changes remain subject to the version publication workflow. You can find the settled contract and its source-language exception in the repository at `specs/2026-09-25-advertised-locale-visibility-spec.md`.

## Why source locale survives a default change

`i18n.content.defaultLocale` is an installation preference. `sourceLocale` is the durable content anchor of an existing document. The ordinary create lifecycle requires the initial content to use the configured default; that locale becomes the new document's source. Updating installation configuration does not rewrite existing documents' source locales.

For example, after changing the default from English to French:

| Concern | Existing English-source document | Newly created document |
|---|---|---|
| Source locale | Remains English | French |
| Fallback floor | English | French |
| Completeness reference for new versions | That version's English field paths | That version's French field paths |
| Stored source-path locale | Remains English | French |

An existing document can still serve French when the applicable read policy permits its French translation. Keeping English as its source does not force all reads to English. Likewise, retaining the source does not preserve every old installation rule: request preferences, search locale selection, and current application configuration can change. The source preserves the content anchor, not a snapshot of the former site configuration.

This separation is the reason ordinary default changes should not require re-anchoring old content. Re-anchoring is an optional maintenance operation that deliberately changes a document's fallback floor and completeness reference. The administration guide covers its command and the current path-lookup and search qualifications.

## Costs of the separation

Public delivery combines a selected version, its completeness ledger, current document controls, caller permissions, and application configuration. Live relationship population adds the current permitted state of related documents. An immutable version is therefore not a self-contained record of everything needed to reproduce a response.

Every read surface must apply compatible rules. Reconstruction, filters, sorts, search, and population cannot independently decide which language is visible. The #102 plan centralizes the policy in core and requires equivalent adapter query behavior. A shared resolver helps, but SQL predicates, search results, and caches still need conformance tests; they do not become correct merely by sharing a type or helper.

Some work identified during #102 corrects existing inconsistencies: projection-dependent completeness, queries using a different locale from returned content, and rich-text refresh retaining stale copied fields. Moving the checkbox set into versions would not itself fix those problems.

The editing interface also combines operations with different timing. Content saves create versions; document-control changes take effect independently. The current combined save writes system fields before content in separate requests. Under the planned #102 contract, enabling a complete translation on the published version can expose it even if the subsequent content save fails. A translation present only in a draft remains unpublished. Confirmation copy must explain the immediate effect rather than imply that all changes wait for publication.

## What history can and cannot establish

Content versions preserve saved field values. The audit log records before/after values for document controls and explicit lifecycle changes. Together they support accountability and investigation beyond content history alone.

They do not currently establish a supported guarantee that “the response delivered at time T” can be replayed exactly. For example, the shared status-transition writer records document identity and old/new status but does not explicitly include the affected version ID in that audit event. Publication also changes the status of previous published versions. A replay design must establish complete event coverage, version association, ordering, initial state, and retention rather than infer those guarantees from the presence of an audit table.

Related content, permissions, schema interpretation, rendering configuration, and previously cached responses add further historical dependencies. Reconstructing what the origin would have permitted is also different from proving what a visitor actually received from a cache. See [Caching](../05-reading-and-delivery/06-caching.md) for current delivery boundaries.

This is why the architectural claim is **immutable content history, with audited mutable workflow and document controls**. Exact historical delivery requires a separately specified capability.

## Open questions and future work

### Source interpretation after re-anchoring

Source locale deserves more care than ordinary routing metadata because completeness was computed relative to it. The current Postgres re-anchor operation checks the latest version for completeness in the proposed source, changes the document-level source, copies that version into a new version, and computes the new ledger. Older versions retain their previous ledgers while reads obtain the document's current source.

Code review identified this regression candidate:

1. A published version has complete English and partial French.
2. A newer draft completes French.
3. Re-anchoring to French passes the latest draft's completeness check and produces another draft.
4. Public reads still select the older published version, now associated with the document's French source.

Tracing the read code predicts a concrete public consequence: a request in the new source locale, French, resolves to the French fallback floor and renders the older published version's partial French content with missing fields. An English request can still resolve to the complete English content, so checking only the old source URL can miss the problem. Historical version reads need the same examination. This scenario has not been reproduced at runtime; it is a code-traced concern, not a claim that ordinary default-locale changes cause it.

The planned #102 rule accepts `L == D.sourceLocale` without an additional completeness check. That source exception relies on the source being a valid fallback for the selected published version. Re-anchoring can break that assumption; #102 does not cause this existing problem and its checkbox gate does not guard against it.

An interim guard to evaluate is refusing re-anchoring when the currently selected published version is incomplete in the proposed source, even if the latest draft is complete. Check that condition within the guarded maintenance transaction, before changing the source or path. A regression should cover both refusal without mutation and a successful change when the latest and published versions support the target, preserving the locale-agnostic exception. This would protect current public delivery without settling historical source interpretation. The operation is Postgres-only maintenance, outside the shared adapter contract; the guard is proposed follow-up work, not implemented behavior.

Follow-up work should reproduce both public and historical cases, test restore after re-anchoring, and decide which source defines each version's interpretation. Restore already reads all locales and writes a fresh version through the normal persistence path; that does not by itself prove the restored content is complete in the new source. Possible designs include retaining the source used to interpret each version, or restricting re-anchoring when retained/public versions cannot support the change. No schema choice is settled here. Do not rewrite old ledgers as an incidental fix or expand #102's agreed implementation scope without a separate decision.

### Reliable historical reconstruction

If you need authoritative reconstruction of past publication and controls, first assess audit coverage and identifiers, then define the historical query contract. Improving audit events may be sufficient for some requirements; a complete site-response replay has broader dependencies. This is separate from retaining useful audit evidence today.

### Coordinated releases and scheduled controls

Approving and releasing a particular combination of content versions, URLs, and language choices together would justify an explicit publication or release record alongside content versions. Define which relationships and configuration it pins before promising reproducibility. Such a record need not replace the current logical-document model.

A narrower request, such as “enable French on Monday,” could use a scheduled, audited document command with concurrency and failure handling. “Publish these edits and enable French together on Monday” requires coordination between those operations. Version publication scheduling does not establish either capability for document controls; neither is introduced by this explanation.

## Implementation references and verification

The following are the implementation points used for this review. Storage commands are internal primitives, not substitutes for authorized lifecycle APIs.

| Concern | Repository reference |
|---|---|
| Initial locale enforcement | `packages/core/src/services/document-lifecycle/create.ts` |
| Control writes, audit, and reconciliation | `packages/core/src/services/document-lifecycle/system-fields.ts` |
| Status mutation and publication archival | `packages/core/src/services/document-lifecycle/status-transition.ts` |
| Restore through new-version persistence | `packages/core/src/services/document-lifecycle/restore.ts` |
| Document, version, ledger, and audit ownership | `packages/db-postgres/src/database/schema/index.ts` |
| Ledger computation and re-anchor mechanics | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| Re-anchor revision guard and audit | `packages/db-postgres/src/index.ts` |

Existing verification includes core lifecycle tests, shared adapter restore conformance, and Postgres locale-fallback and path-reanchor integration suites. The re-anchor scenarios above require explicit regression coverage; this documentation review did not execute those scenarios. Future read-contract changes must be checked in both adapters, with authorization and response shaping tested at the client boundary.
