---
title: "Extraction provider contract"
path: "search-extraction-provider-contract"
summary: "Reference for the provisional extraction types and helpers in @byline/core, including typed failures, capabilities, producer identity, page map version 1, artifacts, the verified source read, and the provider conformance kit."
---

# Extraction provider contract

Companions:
- [Attachment extraction for search](./07-attachment-extraction.md) — the concepts and lifecycle these types serve, with a complete orchestration example.
- [Search provider contract](./04-provider-contract.md) — the equivalent adapter boundary for search engines.
- [File and media uploads](../04-collections/06-file-media-uploads.md#content-identity) — `fileHash`, `storageValidator`, and the `download` and `head` storage methods these helpers build on.

`ExtractionProvider` is the adapter boundary between Byline applications and a document extractor such as Apache Tika, Docling, an OCR service, or a hosted vision model. Read this page when you are writing a driver, or looking up an exact rule while writing orchestration.

:::note[This contract is provisional]
Until this contract is declared stable, a minor release may change these exports, and the changelog will say so. `ExtractionArtifact.schemaVersion` and `PageMapV1.version` version the persisted shapes independently of the package version.
:::

## Where each export lives

| Entry | Exports |
|---|---|
| `@byline/core` | All types on this page except those listed below. `ExtractionProviderError`, `isExtractionProviderError`, `isFileExtractionFailure`, `validatePageMap`, `validateExtractionArtifact`, `producerConfigHash`, `buildExtractionProducer`, `isSourceVerificationEvidence`, `decideExtractionWork`, `exclusionState` |
| `@byline/core/stored-files` | `readVerifiedSource`, `probeVerifiedSource`, `VERIFIED_SOURCE_SPOOL_PREFIX`, and the types `VerifiedSourceRead`, `VerifiedSourceBody`, `SourceProbe`. This entry uses Node built-ins and is server only |
| `@byline/extraction-conformance` | `defineExtractionProviderConformance` and the case list |

## `ExtractionProvider`

```ts
interface ExtractionProvider {
  readonly name: string
  readonly capabilities: ExtractorCapabilities
  readonly configuration?: Readonly<Record<string, JsonValue>>
  readonly outputAffectingHints?: readonly ExtractionHintName[]
  resolveVersion?(options?: { signal?: AbortSignal }): Promise<string>
  extract(input: ExtractionInput): Promise<ExtractionResult>
  ping?(): Promise<void>
}
```

| Member | Rule |
|---|---|
| `name` | A stable driver identifier, recorded on every result |
| `capabilities` | What the driver supports. Consumers gate on it and never assume it |
| `configuration` | Effective output-affecting configuration, included in the producer hash. Omit secrets and endpoints |
| `outputAffectingHints` | Hints that change this driver's output. A driver that ignores a hint omits it |
| `resolveVersion` | The engine version `extract` would report now, without extracting. Rejects with an `infrastructure` error when the service cannot answer. A result must report the same value |
| `extract` | Extracts one file, or rejects with `ExtractionProviderError` |
| `ping` | A boot-time health check for a remote service |

A provider must not read Byline documents, storage, or search, persist anything, or decide eligibility.

## `ExtractorCapabilities`

Every member is required.

| Member | Type | Meaning |
|---|---|---|
| `ocr` | `boolean` | Recognises text on image-only pages |
| `markdown` | `boolean` | Emits structure-aware markdown |
| `tables` | `boolean` | Reconstructs table structure |
| `formulas` | `boolean` | Recognises formulas |
| `charts` | `boolean` | Attempts figure and chart understanding |
| `coordinates` | `boolean` | Reports block positions or reading order |
| `pageMap` | `boolean` | Emits a page map version 1 from a page-aware assembly |
| `structure` | `boolean` | Emits provider-native `structure` |
| `formats` | `string[]` | Accepted MIME types, with `*/*` or `type/*` wildcards |

A provider that declares `markdown`, `structure`, or `pageMap` as `false` must not emit that member, and one that declares `true` must. The conformance kit checks both directions.

## `ExtractionInput` and hints

```ts
interface ExtractionHints {
  filename?: string       // the extension is a parser-selection hint
  mimeType?: string       // the declared type; a parser-selection hint
  language?: string       // BCP 47; selects an OCR model
  ocrLanguages?: string[] // an explicit OCR language list, when it differs
}

interface ExtractionInput extends ExtractionHints {
  data: ReadableStream<Uint8Array> | Uint8Array
  signal?: AbortSignal
}
```

`data` holds verified source bytes. `ReadableStream` is the global web stream type, and a `Buffer` is accepted because it is a `Uint8Array` subclass. A provider consumes the stream to its end or cancels it, and the caller owns any spool file behind it.

## `ExtractionResult` and `ExtractionMetadata`

```ts
interface ExtractionResult {
  provider: string          // equals ExtractionProvider.name
  providerVersion?: string  // the engine version as reported at run time
  plainText: string         // always present; '' when nothing is extractable
  markdown?: string         // only when capabilities.markdown
  structure?: JsonValue     // provider-native and opaque; only when capabilities.structure
  pageMap?: PageMapV1       // only when capabilities.pageMap
  pageCount?: number        // physical pages, when the format has pages
  metadata: ExtractionMetadata
  signals: RoutingSignals
}

interface ExtractionMetadata {
  contentType?: string  // detected MIME type
  pages?: number        // as reported by the file's metadata
  title?: string
  authors?: string[]
  language?: string     // declared or detected, as embedded
  createdAt?: string    // ISO 8601
  producer?: string     // the producing application
}
```

- `pageCount` is the physical page count used by page maps. `metadata.pages` is what the file declares and may disagree, so prefer `pageCount`.
- `metadata.createdAt` must be an ISO 8601 date-time, or `validateExtractionArtifact` rejects the artifact. A driver that cannot normalise an embedded date omits the member rather than passing it through.
- When a provider cannot report `providerVersion`, the member is absent. Orchestration records the version resolved for the run, or `null`, and never invents one.

## `RoutingSignals`

```ts
interface RoutingSignals {
  totalChars: number
  charsPerPage?: number[]
  ocrCandidatePages?: number
  textLayerCoverage?: number // from 0 to 1
}
```

These are cheap classification inputs for a router. They are not page boundaries. Never derive page-map offsets from `charsPerPage`, because it is counted over text that is normalised afterwards.

## Typed failures

```ts
type ExtractionFailureScope = 'file' | 'infrastructure'

class ExtractionProviderError extends Error {
  readonly code: 'ERR_EXTRACTION_PROVIDER'
  readonly failureScope: ExtractionFailureScope
  readonly retryable: boolean
  constructor(message: string, options: {
    failureScope: ExtractionFailureScope
    retryable: boolean
    cause?: unknown
  })
}

function isExtractionProviderError(error: unknown): error is ExtractionProviderError
function isFileExtractionFailure(error: unknown): error is ExtractionProviderError
```

| Scope | Meaning | What orchestration may do |
|---|---|---|
| `file` | The input caused the failure: corrupt, encrypted, or an unsupported format | Record a per-file failure for this source and producer |
| `infrastructure` | The service failed: timeout, unavailable, bad credentials, or misconfiguration | Must not record the file as bad, and must preserve existing artifacts |

- `retryable` is independent policy. Bad credentials are `infrastructure` but are not usefully retryable until repaired.
- An untyped error or an abort is never a file failure.
- The guards use the `code` brand as well as `instanceof`, so an error from a second copy of `@byline/core` still classifies.

:::warning[Some engines report parse failures inside a success response]
Apache Tika's `/rmeta` endpoint can return HTTP 200 with the parse failure in the response metadata. A driver that reads only the status code resolves a corrupt file with empty text, so check for this and reject with a `file` failure. The conformance kit's corrupt fixture catches this.
:::

## Producer identity

```ts
function producerConfigHash(input: {
  provider: string
  configuration?: Readonly<Record<string, JsonValue>>
  hints?: ExtractionHints
  outputAffectingHints?: readonly ExtractionHintName[]
  configurationVersion?: string        // a policy version you choose
  deploymentIdentifier?: string | null // for example a pinned image tag
}): Promise<string>                    // SHA-256 lower-case hex

interface ExtractionProducerIdentity {
  provider: string
  providerVersion: string | null
  producerConfigHash: string
  deploymentIdentifier: string | null
}

function buildExtractionProducer(input: {
  provider: ExtractionProvider
  providerVersion: string | null       // from resolveVersion, or null
  hints?: ExtractionHints
  configurationVersion?: string
  deploymentIdentifier?: string | null
}): Promise<ExtractionProducerIdentity>
```

Use `buildExtractionProducer`, which keeps the identifier consistent with the hash by construction.

- The hash covers canonical JSON: sorted keys, no insignificant whitespace, and `undefined` object members dropped. It rejects other non-JSON values with a `TypeError`, including non-finite numbers, class instances, cycles, array holes, and symbol keys.
- Only hints named in `outputAffectingHints` are kept.
- The engine version is recorded beside the hash, not inside it, so an engine change is visible as its own reuse reason. A deployment identifier is what you deployed rather than what the engine reports, so it is hashed.
- A deployment identifier must be a non-empty string with no leading or trailing whitespace. Absent and `null` mean the same: no identifier.

## Page map version 1

A page map locates each physical page of a paginated source within `plainText`.

```ts
interface PageMapV1 {
  version: 1
  assembly: {
    pageSeparator: string           // inserted between consecutive ranges
    trailing?: 'embedded' | 'none'  // what follows the last page
  }
  pages: Array<{ index: number; label?: string; charStart: number; charEnd: number }>
  unanchored?: Array<{ kind: string; charStart: number; charEnd: number }>
  blocks?: Array<{ page: number; charStart: number; charEnd: number; kind: string }>
}
```

Emit a page map only from a page-aware path that obtains per-page text and assembles `plainText` from it, so offsets are computed against the exact stored string. Offsets are half-open UTF-16 code-unit indices. A provider that cannot produce pages emits none.

`validatePageMap(plainText, map, { pageCount? })` returns `{ ok: true }` or `{ ok: false, issues }`, where each issue has a `code`, a `message`, and an optional `path`.

| Rule | Issue code |
|---|---|
| `map` is an object; lists are arrays of objects with no holes; `label` and `kind` have the right types | `invalid-shape` |
| `version` is 1 | `invalid-version` |
| `pageSeparator` is a string | `invalid-separator` |
| `trailing` is `embedded`, `none`, or absent | `invalid-trailing` |
| Every offset is an integer with `0 ≤ charStart ≤ charEnd ≤ plainText.length` | `invalid-offset` |
| No boundary splits a UTF-16 surrogate pair | `surrogate-split` |
| `pages[].index` is positive and strictly increasing | `invalid-page-index` |
| With `pageCount`, the indexes are exactly `1…pageCount`. An empty page is a zero-length range, not a missing entry | `page-count-mismatch` |
| Page ranges are ordered and do not overlap | `page-overlap` |
| Between two consecutive ranges, the text is exactly `pageSeparator` | `separator-mismatch` |
| No text before the first range or after the last | `text-outside-ranges` |
| Unanchored ranges overlap no page and no other unanchored range | `unanchored-overlap` |
| With `trailing: 'embedded'`, unanchored ranges follow the last page | `unanchored-before-last-page` |
| Without it, no unanchored range follows the last page | `unanchored-after-last-page` |
| A block names a page that exists | `block-unknown-page` |
| A block lies inside the range of the page it names | `block-outside-page` |
| Blocks of one page do not overlap | `block-overlap` |

:::warning[Structural validity is not provenance]
These rules make coverage checkable, but they do not prove that page 3's text came from physical page 3. Two swapped pages pass `validatePageMap`. Only sentinel verification against a fixture proves page provenance, which is what the conformance kit's case 4 does.
:::

## `ExtractionArtifact`

The persisted shape your orchestration builds from a result and a verified read.

```ts
interface ExtractionArtifact {
  schemaVersion: 1
  contentHash: string | null        // source bytes; null only for legacy imports
  sourceVerified: boolean           // true exactly when contentHash came from a verified read
  provider: string
  providerVersion: string | null
  producerConfigHash: string | null // null only for historical imports
  plainText: string
  markdown?: string
  structure?: JsonValue
  pageMap?: PageMapV1
  pageCount?: number
  metadata: ExtractionMetadata
  signals: RoutingSignals
  producedAt: string                // ISO 8601
}
```

Document, version, path, access, selection, and verification evidence are deliberately absent. They belong to references, so one artifact can serve every authorized reference to the same bytes and producer. Neither `contentHash` nor a stored file's `fileHash` is a hash of extracted text.

`validateExtractionArtifact(artifact, { allowUnrecordedProducer? })` returns `{ ok: true }` or `{ ok: false, issues }`. It checks the shape, both hash formats, `sourceVerified === (contentHash !== null)`, recognised `metadata` and `signals` members, `structure` as strict JSON, and the page map against the artifact's own `pageCount`. Unknown members of `metadata` and `signals` are ignored.

- A `null` `producerConfigHash` fails unless `allowUnrecordedProducer` is `true`. Only code reading or importing historical records passes that option. A new extraction records the hash from its `ExtractionProducerIdentity`, which is never `null`.
- An unknown `schemaVersion` is reported alone, as `unsupported-schema-version`. Treat that artifact as unusable for reuse, never as malformed source data.

## `SourceVerificationEvidence`

```ts
interface SourceVerificationEvidence {
  expectedHash: string        // the reference's fileHash at read time
  contentHash: string         // measured from the bytes read; equals expectedHash
  validator: StorageValidator // returned with those bytes
  verifiedAt: string          // ISO 8601
  size?: number
  readBasis?: 'expected' | 'unconditional' | 'fallback'
  preconditionFallback?: 'changed' | 'unsupported-kind' | 'unestablishable'
}
```

`isSourceVerificationEvidence(value, { expectedHash? })` accepts a record only when all of these hold:

1. `value` is a plain object. Unknown extra members are ignored.
2. Both hashes are lower-case SHA-256 and equal, and they equal `expectedHash` when you pass it.
3. `validator` has non-empty string `kind` and `value`, within 32 and 1024 characters.
4. `verifiedAt` is an ISO 8601 date-time.
5. `size`, when present, is a non-negative safe integer.
6. `readBasis` and `preconditionFallback`, when present, hold known values and agree:

| `readBasis` | `preconditionFallback` | Valid |
|---|---|---|
| absent | absent or any reason | Yes. These are records written before `readBasis` existed |
| `fallback` | a reason | Yes |
| `fallback` | absent | No |
| `expected` or `unconditional` | absent | Yes |
| `expected` or `unconditional` | a reason | No |

## `decideExtractionWork`

```ts
interface ExistingExtraction {
  state: 'complete' | 'failed' | 'identity-problem'
  artifact?: Pick<ExtractionArtifact, 'contentHash' | 'sourceVerified' | 'provider'
    | 'providerVersion' | 'producerConfigHash' | 'schemaVersion'>
  evidence?: unknown
}

function decideExtractionWork(input: {
  force?: boolean
  reference: { fileHash?: string | null }
  producer: ExtractionProducerIdentity
  existing?: ExistingExtraction | null // this reference's own output and evidence
}): ExtractionWorkDecision

type ExtractionWorkDecision =
  | { kind: 'identity-problem'; problem: 'missing-hash' }
  | { kind: 'work'; reasons: ExtractionWorkReason[]; versionUnchecked: boolean }
  | {
      kind: 'reuse'
      evidence: SourceVerificationEvidence
      versionUnchecked: boolean
      producerUnchecked: boolean
    }
```

The decision is pure and reads no bytes. A reference without `fileHash` is an identity problem, and `force` does not bypass that. Throws a `TypeError` for a malformed `producer.deploymentIdentifier`.

| Reason | When |
|---|---|
| `force` | `force` is `true`. Reported with any other reasons |
| `no-artifact` | Nothing usable exists for this reference |
| `previous-attempt-unsuccessful` | `state` is `failed` or `identity-problem` |
| `source-changed` | The reference's `fileHash` differs from the artifact's `contentHash` |
| `unverified` | The artifact is legacy or unverified, or there is no valid evidence for the current hash |
| `producer-changed` | The provider, engine version, or configuration hash differs |
| `schema-changed` | The artifact's `schemaVersion` is not the current one |

Add your own reasons, such as an inspection-policy version, and treat the union as the decision.

**Engine version comparison:**

| Current version | Artifact's recorded version | Outcome |
|---|---|---|
| Known | Equal | No version reason |
| Known | Different | `producer-changed` |
| Known | `null`, with a recorded `producerConfigHash` | `producer-changed`, once, because the new artifact records the version |
| Known | `null`, with a `null` `producerConfigHash` | No version reason, and `producerUnchecked: true` on reuse |
| `null` | Any | No version reason |

These rules cannot cause repeated extraction. Record `result.providerVersion` on the artifact when the result reports one, otherwise the version resolved for the run, otherwise `null`. Never copy the artifact's recorded version into the current version, because that would hide an upgrade.

**Reduced assurance flags:**

- `versionUnchecked` is `true` exactly when the current engine version and the deployment identifier are both `null`. An engine upgrade is then not detected.
- `producerUnchecked` is `true` only on `reuse` of an artifact with a `null` `producerConfigHash`. See [Historical output with no recorded producer](./07-attachment-extraction.md#historical-output-with-no-recorded-producer).

## `readVerifiedSource`

```ts
function readVerifiedSource(
  storage: IStorageProvider,
  source: Pick<StoredFileValue, 'storagePath' | 'storageProvider' | 'fileHash' | 'storageValidator'>,
  options?: { knownChanged?: boolean; signal?: AbortSignal; memoryThreshold?: number }
): Promise<VerifiedSourceRead>

type VerifiedSourceRead =
  | { status: 'verified'; evidence: SourceVerificationEvidence; body: VerifiedSourceBody }
  | {
      status: 'identity-problem'
      problem: 'missing-hash' | 'missing-object' | 'hash-mismatch'
      storagePath: string
      expectedHash?: string        // absent for missing-hash
      observedHash?: string        // only for hash-mismatch
      observedValidator?: StorageValidator // only for hash-mismatch
      preconditionFallback?: 'changed' | 'unsupported-kind' | 'unestablishable'
    }
  | {
      status: 'unavailable'
      reason: 'download-unsupported' | 'provider-mismatch' | 'read-failed' | 'aborted'
      cause?: unknown
    }
```

It returns outcomes rather than throwing them. It throws a `TypeError` only for a malformed `memoryThreshold`.

- With no `fileHash`, it reports `missing-hash` without any read.
- The first read expects the saved validator, unless there is none or `knownChanged` is set.
- A `changed`, `unsupported-kind`, or `unestablishable` precondition leads to exactly one unconditional read. An unrecognised reason counts as `unestablishable`. There is never a third read.
- The body is read to its end and hashed. A body shorter than the size the provider reported is `read-failed`, not a mismatch. An abort that fires as the read completes is `aborted`.
- It never writes to storage or changes the saved value, and it never accepts different bytes.

### `VerifiedSourceBody`

```ts
interface VerifiedSourceBody {
  readonly size: number
  stream(): ReadableStream<Uint8Array> // a fresh stream; may be opened more than once
  bytes(): Promise<Uint8Array>         // a copy in memory; avoid for large files
  dispose(): Promise<void>             // deletes any spool file; idempotent
}
```

Bodies up to `memoryThreshold` (default 8 MiB) stay in memory. Larger bodies are spooled to a mode `0600` file in the operating system's temporary directory. Dispose of the body in a `finally` block, because reads fail after `dispose`.

A process crash between spooling and `dispose` leaves the file behind. Its name starts with `VERIFIED_SOURCE_SPOOL_PREFIX`, so an operator can find and remove it.

## `probeVerifiedSource`

```ts
function probeVerifiedSource(
  storage: IStorageProvider,
  storagePath: string,
  evidence: SourceVerificationEvidence | null
): Promise<SourceProbe>
```

It compares `head()` with the **evidence's** validator, never the reference's saved one, so a matching copied value cannot stand in for verification.

| Status | Meaning | What you do |
|---|---|---|
| `unchanged` | The validator matches | Reuse |
| `changed` | A different value or kind | Read with `knownChanged`, and the hash decides |
| `missing-object` | No object exists | Treat it as an identity problem |
| `unprobed`, `head-unsupported` | The provider has no `head` | You may reuse, at reduced assurance: only a separate `backfillStoredFileIdentity` verify run detects a same-path replacement |
| `unprobed`, `no-evidence` | No valid evidence, and `head` is not called | Reuse is not permitted |
| `unavailable` | `head` failed | Treat it as an infrastructure outcome |

An unchanged probe does not establish a first baseline, and it does not prove the object cannot change afterwards.

## Lifecycle reporting types

```ts
type DerivationOutcome =
  | { kind: 'reused' }
  | { kind: 'extracted' }
  | { kind: 'identity-problem'; problem: SourceIdentityProblem }
  | { kind: 'source-unavailable'; reason: SourceUnavailableReason }
  | { kind: 'provider-failed'; failureScope: ExtractionFailureScope; retryable: boolean }
  | { kind: 'promotion-refused'; reason: PromotionRefusalReason }

type EligibilityUpdateOutcome = { kind: 'not-required' } | { kind: 'recorded' } | { kind: 'failed' }

type ProjectionOutcome =
  | { kind: 'written' }
  | { kind: 'pending'; reason: 'write-failed' | 'not-attempted' | 'stale-write' }
```

`AttachmentProcessingReport` combines these with `documentId`, `storagePath`, and optional `documentVersionId`, `runId`, and `exclusion`. `PromotionRefusalReason` is `hash-changed`, `version-changed`, `access-changed`, `artifact-mismatch`, or `claim-lost`.

`exclusionState(eligibility, projection)` derives the state you report. `projection` is the outcome of the first write attempted after the eligibility update.

| Eligibility update | Projection after it | Exclusion state |
|---|---|---|
| `not-required` | any | `not-required` |
| `failed` | any, including `written` | `pending: eligibility-update-failed` |
| `recorded` | `written` | `excluded` |
| `recorded` | `pending` with reason *r* | `pending: r` |
| `recorded` | none attempted | `pending: not-attempted` |

`written` means the provider acknowledged a write. It is not a durable exclusion guarantee, as [Search consistency](./07-attachment-extraction.md#search-consistency) explains.

## Conformance kit

`@byline/extraction-conformance` tests a driver with Vitest. Its [README](https://github.com/Byline-CMS/bylinecms.dev/blob/develop/packages/extraction-conformance/README.md) explains how to run it.

```ts
import { defineExtractionProviderConformance } from '@byline/extraction-conformance'

defineExtractionProviderConformance({
  name: 'my-driver',
  createProvider: () => createMyDriver({ url: process.env.DRIVER_URL ?? '' }),
  createUnavailableProvider: () => createMyDriver({ url: 'http://127.0.0.1:9' }),
})
```

| Case | Checks | Skipped when |
|---|---|---|
| 1 Capability honesty | The capability shape, and that `markdown`, `structure`, and `pageMap` appear exactly when declared | The member check, when the driver does not accept PDFs |
| 2 Result shape | The full structural shape, including the page map against `pageCount` | The driver does not accept PDFs |
| 3 Sentinel text | Every page's sentinel appears in `plainText` | The driver does not accept PDFs |
| 4 Page map sentinels | The map passes `validatePageMap`, and each sentinel lies in its own page and no other. This is the kit's only provenance claim | `capabilities.pageMap` is `false`, or the driver does not accept PDFs |
| 5 Typed file failure | A corrupt file rejects with `file`. A truncated PDF rejects with `file` or resolves with a valid result, because recovering a damaged file is not a failure. An unlisted type rejects with `file`, unless `formats` holds `*/*` | The PDF checks, when the driver does not accept PDFs |
| 6 Typed infrastructure failure | An unavailable service rejects with `infrastructure`, and `ping`, if defined, rejects | There is no `createUnavailableProvider` hook |
| 7 Abort | An aborted signal rejects, and the rejection is not a file failure | Never |
| 8 Input forms | Stream and byte-array input give identical `plainText` | The driver does not accept PDFs |
| 9 Version consistency | `resolveVersion` gives a non-empty string, equal to the result's `providerVersion` | There is no `resolveVersion`. The result comparison, when the driver does not accept PDFs |

Case 9 assumes the engine does not change during the test run. A version change in the middle of a production run is legitimate, and the artifact records the result's version. OCR, tables, formulas, and charts are declared by the author and are not verified by the kit.

## Not yet shipped

The types on this page do not imply a store, worker, search join, or reference driver. [Attachment extraction for search](./07-attachment-extraction.md#not-yet-shipped) lists what is planned.
