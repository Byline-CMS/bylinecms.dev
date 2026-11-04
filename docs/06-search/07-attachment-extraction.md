---
title: "Attachment extraction for search"
path: "search-attachment-extraction"
summary: "The concepts and lifecycle behind extracting text from stored files: what Byline provides today, what your application implements, and how source identity, retention, eligibility, and search consistency fit together."
---

# Attachment extraction for search

Companions:
- [Extraction provider contract](./10-extraction-provider-contract.md) — every exported type and helper, with its exact rules, and the conformance kit.
- [Search](./index.md) — the search architecture consumes text projections and does not extract files itself.
- [Indexing and reindexing](./02-indexing-and-reindexing.md) — completed extraction triggers the existing published-document synchronization path.
- [Portable multilingual analysis](./05-portable-analysis.md) — extracted plain text enters the same locale-aware analyzer as authored content.
- [File and media uploads](../04-collections/06-file-media-uploads.md) — uploaded files, content identity, and storage reads are the inputs to extraction.

Attachment extraction turns a stored file, such as a PDF, into text and structure that search, retrieval, and agents can use. Read this page when you are wiring extraction into a collection, or deciding whether extracted text may appear in search.

Byline ships the provisional contracts and source-verification building blocks. It does not yet ship an extraction store, worker, search join, or reference driver, so your application implements those parts. A production institutional deployment already does this: it extracts through an out-of-process Apache Tika service, persists the output in PostgreSQL, and joins locale-aware text into its search index without re-extracting during a reindex. That experience informs the contracts described here.

## Why extraction is separate from indexing

Extraction and indexing have different costs and lifecycles.

- Index upserts are cheap and repeatable. A rebuild may run them for every published document.
- PDF parsing, OCR, table reconstruction, and vision-model calls can take seconds or minutes, and may incur external cost.
- Extracted markdown or structured blocks can serve retrieval and export as well as search.
- A search provider should not need a separate integration for every extractor.

Putting extraction inside `SearchProvider.upsert()` would repeat expensive work on every reindex and create one extractor integration per search engine. Persisting extraction output separately avoids both problems. Do not store it as synthetic collection fields: it is derived state with its own failure and rebuild behaviour.

## Vocabulary

Six terms define the model.

- An **extraction provider** is a driver that accepts file bytes and hints, then returns a result or rejects with a typed error. It never reads Byline documents, storage, search, or access state.
- **Orchestration** is the code around a provider. It decides whether work is required, reads and verifies the source, calls the provider, records the outcome, and updates search. Your application writes it today.
- The **expected identity** is what the document records: the saved `fileHash` and `storageValidator` of the attachment. The **observed identity** is the SHA-256 of the complete bytes a read actually returned, and the validator returned with those bytes.
- An **artifact** is one successful extraction output, with its source content hash and its producer. Artifacts are immutable, and several references may share one.
- A **reference** is the association between a document, a stored file path, and a purpose such as search. Selection, eligibility, access, and verification evidence belong to the reference, not the artifact.
- A **projection** is what a search provider holds for a document. A projection is *pending* when it does not yet reflect the current eligible selection.

## What Byline provides and what you implement

| Concern | Status | Where |
|---|---|---|
| Provider, result, artifact, and page map types | Ships, provisional | [`@byline/core`](./10-extraction-provider-contract.md) |
| Typed failures and their guards | Ships, provisional | `@byline/core` |
| Page map, artifact, and evidence validators | Ships, provisional | `@byline/core` |
| Producer hash and the work decision | Ships, provisional | `@byline/core` |
| Exclusion state and reporting vocabulary | Ships, provisional | `@byline/core` |
| Verified source read and change probe | Ships, provisional | `@byline/core/stored-files` (server only) |
| Provider conformance kit | Ships, provisional | `@byline/extraction-conformance` |
| Artifact, attempt, and reference storage | You implement | Your application |
| Triggers, workers, retries, and scheduling | You implement | Your application |
| Joining extracted text into `SearchDocument` | You implement | Your application |
| Provider drivers such as Tika or Docling | You implement | Your application |
| Editor messages and diagnostics | You implement | Your application |

## The lifecycle

The building blocks fit together as one flow. `decideExtractionWork` runs first and reads no bytes. Only bytes that pass the verified read can reach the provider.

```text
saved file value (fileHash, storageValidator) + this reference's existing output
                        |
                        v
                decideExtractionWork()
          |                |                  |
   identity-problem      reuse              work
          |                |                  |
          |                v                  |
          |       probeVerifiedSource()       |
          |        |       |        |         |
          |    unchanged changed  missing     |
          |        |       |        |         |
          |     keep it    +--------|---------+
          |                |        |
          |                v        |
          |      readVerifiedSource()
          |        |          |     |
          |    verified    identity-problem or unavailable
          |        |          |     |
          |        v          v     v
          |  reuse: replace evidence, keep output
          |  work: provider.extract()
          v
report the outcome; update eligibility; attempt a search write
```

This function implements that flow. The `store` argument stands for your own persistence, which must apply each write only if the reference's `fileHash` and document version are still current, so a late result cannot replace newer work.

```ts
import {
  buildExtractionProducer,
  decideExtractionWork,
  type DerivationOutcome,
  type ExistingExtraction,
  type ExtractionArtifact,
  type ExtractionProvider,
  type IStorageProvider,
  isExtractionProviderError,
  type SourceVerificationEvidence,
  type StoredFileValue,
} from '@byline/core'
import { probeVerifiedSource, readVerifiedSource } from '@byline/core/stored-files'

interface ExtractionStore {
  saveOutput(artifact: ExtractionArtifact, evidence: SourceVerificationEvidence): Promise<void>
  replaceEvidence(evidence: SourceVerificationEvidence): Promise<void>
}

export async function ensureExtraction(
  storage: IStorageProvider,
  provider: ExtractionProvider,
  file: StoredFileValue,
  existing: ExistingExtraction | null,
  store: ExtractionStore
): Promise<DerivationOutcome> {
  // The same hints go to the producer and to the provider, so a hint that changes the
  // output also changes the producer.
  const hints = { filename: file.filename, mimeType: file.mimeType }
  const producer = await buildExtractionProducer({
    provider,
    providerVersion: (await provider.resolveVersion?.()) ?? null,
    hints,
  })

  const decision = decideExtractionWork({ reference: file, producer, existing })
  if (decision.kind === 'identity-problem') {
    return { kind: 'identity-problem', problem: decision.problem }
  }

  let knownChanged = false
  if (decision.kind === 'reuse') {
    const probe = await probeVerifiedSource(storage, file.storagePath, decision.evidence)
    if (probe.status === 'unchanged' || probe.status === 'unprobed') return { kind: 'reused' }
    if (probe.status === 'missing-object') {
      return { kind: 'identity-problem', problem: 'missing-object' }
    }
    if (probe.status === 'unavailable') {
      return { kind: 'source-unavailable', reason: 'read-failed' }
    }
    knownChanged = true
  }

  const read = await readVerifiedSource(storage, file, { knownChanged })
  if (read.status === 'identity-problem') return { kind: 'identity-problem', problem: read.problem }
  if (read.status === 'unavailable') return { kind: 'source-unavailable', reason: read.reason }

  try {
    if (decision.kind === 'reuse') {
      // The token changed and the bytes did not. Keep the output; refresh the evidence.
      await store.replaceEvidence(read.evidence)
      return { kind: 'reused' }
    }
    const result = await provider.extract({ ...hints, data: read.body.stream() })
    const artifact: ExtractionArtifact = {
      ...result,
      schemaVersion: 1,
      contentHash: read.evidence.contentHash,
      sourceVerified: true,
      // The result's own version wins, because it is what produced this output.
      providerVersion: result.providerVersion ?? producer.providerVersion,
      producerConfigHash: producer.producerConfigHash,
      producedAt: new Date().toISOString(),
    }
    await store.saveOutput(artifact, read.evidence)
    return { kind: 'extracted' }
  } catch (error) {
    if (!isExtractionProviderError(error)) throw error
    return {
      kind: 'provider-failed',
      failureScope: error.failureScope,
      retryable: error.retryable,
    }
  } finally {
    await read.body.dispose()
  }
}
```

A provider's `resolveVersion` can reject when its service is down. That is an infrastructure outcome for the run, not a reason to re-extract, so handle it in the same way your application handles any unavailable service.

## Three independent outcomes

A save, an extraction, and a search update are separate facts. One success flag cannot report them, and a hook that runs after commit cannot undo a save by throwing.

1. **Editorial persistence.** Was the document saved, and which version was committed? Byline's document lifecycle already reports this.
2. **Derivation.** Was the source verified, and was extraction reused, completed, unavailable, blocked, or refused?
3. **Projection.** Does search reflect the current eligible selection, or is repair pending?

One more fact sits between derivation and projection, and it must not be inferred: whether the **eligibility update** was recorded. When a derivation makes previously eligible text ineligible, orchestration must durably record that before a search write can omit the text. If recording fails, a search write that succeeds still joins the old text, so a successful write is not exclusion.

`exclusionState` encodes this rule. Report "excluded" only when it returns `excluded`. Report every `pending` state as "exclusion pending".

```ts
import { exclusionState } from '@byline/core'

exclusionState({ kind: 'failed' }, { kind: 'written' })
// { state: 'pending', reason: 'eligibility-update-failed' }

exclusionState({ kind: 'recorded' }, { kind: 'written' })
// { state: 'excluded' }
```

Editor messages should be concise, with an action link rather than raw hashes. Show hashes and validators only where they exist and the viewer is authorized. Never include credentials, signed URLs, or file contents.

## Source identity

Only verified bytes reach an extractor. `readVerifiedSource` reads the complete body and hashes it before any caller sees a byte, so a result can never be promoted from bytes that later fail verification.

A storage token and a content hash answer different questions, and the read keeps them apart.

- **A changed token does not prove changed content.** When the saved validator no longer matches, Byline makes exactly one unconditional read, and the hash decides. This lets a restored or rewritten file with the same bytes continue without an identity problem.
- **A different hash is an identity problem.** The stored object is not the file the document records. Nothing is extracted, and the saved value is left unchanged. Byline never adopts unexpected bytes on its own.
- **A failed read says nothing about the file.** A network error, an aborted read, or a provider without `download` is reported as unavailable, not as an identity problem.

An identity problem is one of `missing-hash`, `missing-object`, or `hash-mismatch`.

**Verification evidence** is the record that binds an extraction to one verified read: the expected hash, the observed hash, the validator returned with those bytes, and the time. A hash copied from the saved file value is not evidence. Evidence describes one read at one time and is not continuous storage monitoring.

### When the token changes and the bytes do not

A `reuse` decision whose probe returns `changed` leads to a read with `knownChanged`. If that read is `verified`, the bytes are unchanged, and output depends only on the bytes and the producer. Keep the existing output, make no provider call, and replace the reference's evidence with the evidence from this read.

Persist evidence with the reference, or in an attempt record the reference points to, and never on the immutable artifact. Each reference holds its own evidence, so an artifact shared by two references never carries one reference's validator for the other. Make the write conditional on the reference's `fileHash` still equaling the verified hash, so a late read cannot overwrite evidence for a newer file.

If the evidence write fails, the existing output stays selected, and you should report the failure. The next probe returns `changed` again and repeats one read. It does not cause re-extraction.

## Reuse, force, and plain reindex

These three operations do different work.

| Operation | Reads the file | Runs the provider | Purpose |
|---|---|---|---|
| Ordinary extraction | Only when required | Only when `decideExtractionWork` returns `work` | Keep output current at the lowest cost |
| Forced extraction | Yes, with verification | Yes | Re-run an unchanged file deliberately |
| Plain reindex | No | No | Rebuild search from existing eligible text |

Force bypasses reuse. It never bypasses the verified read, and it cannot make Byline accept different bytes.

### The producer before reuse

The same bytes can give different output under a different engine, version, or setting, so an artifact is identified by its source hash and its **producer**. Two values can identify the engine. The **engine version** is what the engine reports. The **deployment identifier** is a value you control, such as a pinned image tag, and you change it when you change the engine. It is part of the configuration hash.

Knowing neither is reduced assurance. Reuse proceeds, and `versionUnchecked: true` reports that an engine upgrade would not be detected.

### Historical output with no recorded producer

An application can hold verified output from before producer identity existed. Its source is proven and its configuration is unknown, and that unknown must stay visible, so do not write a current configuration hash onto it. Give such an artifact a `null` `producerConfigHash`.

Adopting these contracts must not by itself cause re-extraction of that output. When every other reuse condition holds, `decideExtractionWork` returns `reuse` with `producerUnchecked: true`. A changed configuration or deployment identifier is not detected for this output, and you replace it by choosing to extract again.

The exception is narrow:

- A provider mismatch, two known engine versions that differ, a changed source, missing evidence, a failed state, a different schema, and force all keep their usual results.
- A row with a recorded configuration hash is compared as usual. Use `null` only for a configuration that was never recorded.
- It means "keep the output this reference already holds". A content-addressed lookup for a fully identified producer must not return such an artifact, and another reference with identical bytes must not reuse it through this rule.
- Two historical rows can share a source hash and provider and still hold different text, because their unrecorded settings differed. Do not deduplicate them against each other. Import each under an idempotent key derived from its source row.

Adopting a release does not authorize a production extraction run. Any such run needs its own administrative decision, scope, and approval.

## Retention and eligibility

An artifact remains true evidence of the bytes it was produced from. An identity problem, a replaced file, or a restriction breaks its **eligibility** for the current reference. It does not delete the artifact or overwrite it with an empty or failed record.

Provider failures and storage outages preserve existing successful artifacts. A first-ever failure leaves no text for that source, and another source's old text is never used as a fallback.

Provider failures come in two scopes, and only one of them describes the file. A `file` failure may be recorded against this source and producer. An `infrastructure` failure must not record the file as bad. An untyped error or an abort is never a file failure.

## Search consistency

Removing ineligible text from search can be guaranteed at two strengths. Byline documents both and, in this release, provides neither as runtime behaviour.

**Eventual exclusion with pending reporting.** When text becomes ineligible, the next successful projection write for the document omits it. Every path that makes text ineligible first records the eligibility update, then attempts that write immediately, and reports the `exclusionState`. A failed write leaves old text searchable until a later successful write repairs it, and a delayed older write can briefly restore it. You can build this level today.

**Durable read-time exclusion.** Eligibility is durable state, each projection carries a revision, and every search request admits only `(document id, current projection revision)` keys. A failed or late write then cannot surface ineligible text in hits, totals, facets, snippets, or later retrieval and citations, and a missing state row fails closed. This level needs search contract features that do not ship yet: string filter fields with `$in`, `where` on document id, returned fields on hits, and stale-write prevention on upsert.

## Recovering from an identity problem

Inspect the evidence first. If the replacement was intended, re-upload through the normal workflow and save, which records a new identity. Otherwise, restore or upload the intended file. Restored bytes may carry a new validator, and the fallback read can verify their hash and record the new token.

Then re-verify, select against the current reference, and repair search before you clear the problem. Never treat forced extraction as authority to rewrite the saved file value.

## Migrating existing extraction records

An importer that moves existing extraction rows into an artifact model classifies each row by its state.

| Row state | Import as |
|---|---|
| Identity problem | An attempt carrying the reason. Text is retained for audit and never selected. The reference stays ineligible until verified |
| Complete, with valid evidence for the reference's hash | A verified artifact, with the evidence moved to the reference. Producer fields only as far as recorded, and `producerConfigHash: null` when no configuration was recorded |
| Complete, without valid evidence, including a hash copied from the saved value | A legacy artifact with `contentHash: null` and `sourceVerified: false`. It may stay selected so search does not change at cutover. It is never assigned a later-measured hash |
| Failed | An attempt only, never an artifact or a selection |

A placeholder such as a hash of a fixed string is not a recorded configuration. Compared with a real hash, it reads as `producer-changed` and would cause re-extraction. If you keep one in a non-nullable column, map it to `null` before calling `decideExtractionWork`.

A legacy artifact is never reused as verified. Replace a legacy selection once a verified artifact exists for the current hash, and offer rollback to a legacy artifact only while none exists.

## Joining extracted text into search

The join belongs before `SearchProvider.upsert()`, while your application assembles or decorates the `SearchDocument`. Extracted plain text becomes another body contribution, normally at a lower weight than the title and authored summary.

Per-locale indexing needs an explicit rule for attachment language. An artifact may carry a declared or detected language that differs from the owning document's locale, and unknown-language text still needs a documented home. Byline does not yet define this rule, so your application must choose one and apply it consistently.

## Routing between extractors

One installation may compose several drivers behind a router, which is itself an `ExtractionProvider`:

1. use a fast text-layer extractor for born-digital PDFs and ordinary office files;
2. send scanned pages to OCR;
3. send layout-heavy tables or formulas to a structure-aware service; and
4. reserve vision-model extraction for pages that fail cheaper paths.

`RoutingSignals` carries cheap classification inputs for this. Apache Tika is a practical default where broad format support matters, and Docling is appropriate where structured PDF output matters. Keep these services out of process, so the Node.js application orchestrates them rather than embedding Java, Python, model runtimes, or GPU dependencies.

## Not yet shipped

These parts are planned and do not exist in Byline today. Do not build on them until a release documents them.

- An artifact store, with attempts, references, selection history, and reviews.
- The search join, projection revisions, and the read guard for durable exclusion.
- Workers, jobs, and claim fencing for late results.
- A router, tiering, and quality gates.
- An admin extraction log or any other user interface.
- Reference drivers for Tika or Docling.
- Server-issued upload receipts, tracked in [issue #108](https://github.com/Byline-CMS/bylinecms.dev/issues/108).
- Embargo and access restrictions.
- A stable page map. Version 1 stays provisional until sentinel evidence from a real corpus supports declaring it stable.
