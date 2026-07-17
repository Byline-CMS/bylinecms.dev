/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  CollectionDefinition,
  ICollectionCommands,
  IDocumentCommands,
  TreeDeleteMutationResult,
  TreeMutationResult,
  TreePlacementState,
} from '@byline/core'
import {
  ERR_CONFLICT,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  generateKeyBetween,
  TREE_PLACEMENT_STALE_MARKER,
} from '@byline/core'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import {
  booleanStore,
  collections,
  currentDocumentsView,
  datetimeStore,
  documentAvailableLocales,
  documentPaths,
  documentRelationships,
  documents,
  documentVersionLocales,
  documentVersions,
  fileStore,
  jsonStore,
  metaStore,
  numericStore,
  relationStore,
  textStore,
} from '../../database/schema/index.js'
import { flattenFieldSetData } from './storage-flatten.js'
import { prepareFieldInsertBuckets } from './storage-insert.js'
import { getFirstOrThrow } from './storage-utils.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = NodePgDatabase<typeof schema>
/** The transaction handle passed to `this.db.transaction(async (tx) => …)`. */
type TxConnection = Parameters<Parameters<DatabaseConnection['transaction']>[0]>[0]

/**
 * Depth backstop for the document-tree recursive walks (cycle guard, ancestor
 * walk). The write-path cycle guard prevents true cycles, so this only bounds
 * recursion against pre-existing pathological state — far deeper than any real
 * documentation hierarchy. See docs/04-collections/04-document-trees.md.
 */
const TREE_MAX_DEPTH = 10_000

const staleTreePlacementMessage = (message: string): string =>
  `${TREE_PLACEMENT_STALE_MARKER} tree placement is stale: ${message}`

/** Outcome of re-anchoring a single document's content source locale. */
export type ReAnchorStatus = 'reanchored' | 'skipped-incomplete' | 'already-anchored' | 'not-found'

export interface ReAnchorResult {
  documentId: string
  status: ReAnchorStatus
  /** The document's source locale before the operation (when known). */
  fromLocale?: string
  /** The target source locale. */
  toLocale: string
  /** The new version id written on a successful re-anchor. */
  newVersionId?: string
}

export interface ReAnchorReport {
  targetLocale: string
  dryRun: boolean
  total: number
  reanchored: number
  skippedIncomplete: number
  alreadyAnchored: number
  notFound: number
  /** Per-document outcomes, for logging / inspection. */
  results: ReAnchorResult[]
}

/**
 * CollectionCommands
 */
export class CollectionCommands implements ICollectionCommands {
  constructor(private dbManager: DBManager) {}

  /**
   * The executor for this call — the ambient transaction when a
   * `withTransaction` boundary is open, otherwise the pool. Resolved per
   * access so every `this.db.*` below transparently joins an enclosing
   * transaction with no call-site change. See docs/03-architecture/03-transactions.md.
   */
  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async create(
    path: string,
    config: CollectionDefinition,
    opts?: { version?: number; schemaHash?: string }
  ) {
    return await this.db
      .insert(collections)
      .values({
        id: uuidv7(),
        path,
        singular: config.labels.singular || path, // Default to path if singular not provided
        plural: config.labels.plural || `${path}s`, // Default to pluralized path if not
        config,
        ...(opts?.version !== undefined ? { version: opts.version } : {}),
        ...(opts?.schemaHash !== undefined ? { schema_hash: opts.schemaHash } : {}),
      })
      .returning()
  }

  async update(
    id: string,
    patch: {
      config?: CollectionDefinition
      version?: number
      schemaHash?: string
    }
  ) {
    const set: Record<string, unknown> = { updated_at: new Date() }
    if (patch.config !== undefined) set.config = patch.config
    if (patch.version !== undefined) set.version = patch.version
    if (patch.schemaHash !== undefined) set.schema_hash = patch.schemaHash
    return await this.db.update(collections).set(set).where(eq(collections.id, id)).returning()
  }

  async delete(id: string) {
    return await this.db.delete(collections).where(eq(collections.id, id))
  }
}

/**
 * DocumentCommands
 */
export class DocumentCommands implements IDocumentCommands {
  constructor(
    private dbManager: DBManager,
    private defaultContentLocale: string
  ) {}

  /**
   * The executor for this call — the ambient transaction when a
   * `withTransaction` boundary is open, otherwise the pool. Resolved per
   * access so every `this.db.*` below transparently joins an enclosing
   * transaction with no call-site change. See docs/03-architecture/03-transactions.md.
   */
  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  /**
   * createDocumentVersion
   *
   * Creates a new document or a new version of an existing document.
   *
   * @param params - Options for creating the document
   * @returns The created document and the number of field values inserted
   */
  async createDocumentVersion(params: {
    documentId?: string // Optional logical document ID when creating a new version for the same logical document
    collectionId: string
    collectionVersion: number
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    /**
     * Optional. When provided, upserts a row into byline_document_paths
     * keyed by (document_id, <document source_locale>). Omitted by the
     * lifecycle for non-source-locale (translation) saves so the existing
     * path row is left untouched.
     */
    path?: string
    /**
     * Optional. When provided, replaces the document's advertised-locale set
     * in byline_document_available_locales wholesale (delete-then-insert).
     * `undefined` leaves the existing set untouched (sticky across versions,
     * like `path`); an empty array clears it (advertise nothing). The locale
     * values are the advertised content locales themselves, not the default
     * locale. See docs/07-internationalization/index.md.
     */
    availableLocales?: string[]
    locale?: string
    status?: string
    createdBy?: string
    previousVersionId?: string
    orderKey?: string
  }) {
    return await this.db.transaction(async (tx) => {
      let documentId = params.documentId

      // 1. Create the main document if needed, and resolve the document's
      // `source_locale` — its per-document data anchor. A brand-new document
      // is anchored to the configured default content locale (the locale it is
      // authored in; `createDocument` enforces create-in-default). An existing
      // document carries its own anchor on `byline_documents`; read it so the
      // path row and the completeness ledger below key off *this document's*
      // source locale rather than the mutable global default. NULL (a row not
      // yet touched by `backfillSourceLocales`) falls back to the configured
      // default — the value it was implicitly authored against.
      // See docs/07-internationalization/index.md.
      let sourceLocale: string
      if (documentId == null) {
        documentId = uuidv7()
        sourceLocale = this.defaultContentLocale
        const _document = await tx
          .insert(documents)
          .values({
            id: documentId,
            collection_id: params.collectionId,
            order_key: params.orderKey ?? null,
            source_locale: sourceLocale,
          })
          .returning()
          .then(getFirstOrThrow('Failed to create document'))
      } else {
        const existing = await tx
          .select({ source_locale: documents.source_locale })
          .from(documents)
          .where(eq(documents.id, documentId))
          .then(getFirstOrThrow('Failed to load document for new version'))
        sourceLocale = existing.source_locale ?? this.defaultContentLocale
      }

      // 2. Create the document version
      const documentVersion = await tx
        .insert(documentVersions)
        .values({
          id: uuidv7(), // Document version id
          document_id: documentId,
          collection_id: params.collectionId,
          collection_version: params.collectionVersion,
          event_type: params.action ?? 'create',
          status: params.status ?? 'draft',
          created_by: params.createdBy ?? null,
        })
        .returning()
        .then(getFirstOrThrow('Failed to create document version'))

      // 2a. Upsert the document_paths row when a path is supplied. The path
      // row lives under the document's `source_locale` (its data anchor),
      // not the mutable global default — so a re-anchored document, or any
      // document read after the global default is switched, still resolves by
      // path. The lifecycle layer skips this param for non-source-locale
      // (translation) saves. Unique-constraint violations on
      // (collection_id, locale, path) bubble up as a Postgres error which the
      // lifecycle wraps as ERR_PATH_CONFLICT.
      if (params.path !== undefined) {
        await this.writeDocumentPath(tx, {
          documentId,
          locale: sourceLocale,
          collectionId: params.collectionId,
          path: params.path,
        })
      }

      // 2b. Replace the document_available_locales rows when an editorial set
      // is supplied. Document-grain and sticky across versions: `undefined`
      // leaves the existing set untouched (the lifecycle omits the param on
      // saves that don't touch advertising), while an explicit array — empty
      // included — replaces it wholesale. Deduplicated so a caller-supplied
      // duplicate doesn't collide on the (document_id, locale) primary key.
      if (params.availableLocales !== undefined) {
        await this.writeDocumentAvailableLocales(tx, {
          documentId,
          collectionId: params.collectionId,
          availableLocales: params.availableLocales,
        })
      }

      // 3. Flatten the document data to field values
      const flattenedFields = flattenFieldSetData(
        params.collectionConfig.fields,
        params.documentData,
        params.locale ?? 'all'
      )

      // 4. Batch-insert all field values, grouped by store type
      const storeBuckets = prepareFieldInsertBuckets(
        flattenedFields,
        documentVersion.id,
        params.collectionId
      )

      if (storeBuckets.text.length > 0) {
        await tx.insert(textStore).values(storeBuckets.text)
      }

      if (storeBuckets.numeric.length > 0) {
        await tx.insert(numericStore).values(storeBuckets.numeric)
      }

      if (storeBuckets.boolean.length > 0) {
        await tx.insert(booleanStore).values(storeBuckets.boolean)
      }

      if (storeBuckets.datetime.length > 0) {
        await tx.insert(datetimeStore).values(storeBuckets.datetime)
      }

      if (storeBuckets.file.length > 0) {
        await tx.insert(fileStore).values(storeBuckets.file)
      }

      if (storeBuckets.relation.length > 0) {
        await tx.insert(relationStore).values(storeBuckets.relation)
      }

      if (storeBuckets.json.length > 0) {
        await tx.insert(jsonStore).values(storeBuckets.json)
      }

      if (storeBuckets.meta.length > 0) {
        await tx.insert(metaStore).values(storeBuckets.meta)
      }

      // 5. Copy field-value rows for other locales from the previous version.
      // When saving in a specific locale (e.g. 'fr'), only rows for that locale
      // and locale='all' are written above. Any existing rows for other locales
      // (e.g. 'en', 'es') from the previous version must be carried forward so
      // per-locale content is not lost under immutable versioning.
      //
      // Each store table is copied in a separate execute() call because
      // node-postgres does not support multiple statements in a single
      // parameterised query. All calls share the same transaction.
      if (params.previousVersionId && params.locale && params.locale !== 'all') {
        const prevId = params.previousVersionId
        const newId = documentVersion.id
        const activeLoc = params.locale

        await tx.execute(sql`
          INSERT INTO byline_store_text
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, word_count, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, word_count, NOW(), NOW()
          FROM byline_store_text
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_numeric
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, NOW(), NOW()
          FROM byline_store_numeric
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_boolean
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, NOW(), NOW()
          FROM byline_store_boolean
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_datetime
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, NOW(), NOW()
          FROM byline_store_datetime
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_json
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, NOW(), NOW()
          FROM byline_store_json
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_relation
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, NOW(), NOW()
          FROM byline_store_relation
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_file
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, NOW(), NOW()
          FROM byline_store_file
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)
      }

      // 6. Record the version's available content locales for
      // `localeFallback: 'strict'` reads. A locale is "available" when it
      // covers every localized field path the default content locale has
      // (path-coverage). Derived from the *persisted* localized rows, so it
      // accounts for the per-locale carry-forward in step 5 — not just the
      // freshly-flattened locale. A version with no localized content at all
      // records a single `'all'` sentinel (it renders identically in any
      // locale). Status-blind by design — see docs/07-internationalization/index.md.
      await this.writeVersionLocaleLedger(tx, documentVersion.id, sourceLocale)

      return {
        document: documentVersion,
        fieldCount: flattenedFields.length,
      }
    })
  }

  /**
   * writeDocumentPath
   *
   * Upsert the `byline_document_paths` row for a (document, locale) pair. The
   * path row is document-grain and sticky across versions — it lives under the
   * document's `source_locale` (its data anchor), not the mutable global
   * default. Shared by `createDocumentVersion` (step 2a, create write path) and
   * the standalone `updateDocumentPath` command (the non-versioned admin path
   * widget write). The unique constraint on `(collection_id, locale, path)` may
   * raise a `23505`, which the lifecycle layer maps to `ERR_PATH_CONFLICT`.
   */
  private async writeDocumentPath(
    tx: TxConnection,
    args: { documentId: string; locale: string; collectionId: string; path: string }
  ): Promise<void> {
    await tx
      .insert(documentPaths)
      .values({
        document_id: args.documentId,
        locale: args.locale,
        collection_id: args.collectionId,
        path: args.path,
      })
      .onConflictDoUpdate({
        target: [documentPaths.document_id, documentPaths.locale],
        set: {
          path: args.path,
          collection_id: args.collectionId,
          updated_at: new Date(),
        },
      })
  }

  /**
   * writeDocumentAvailableLocales
   *
   * Replace a document's `byline_document_available_locales` rows wholesale —
   * the editorial advertised-locale set. Document-grain and sticky across
   * versions: `delete`-then-`insert`, deduplicated so a caller-supplied
   * duplicate doesn't collide on the `(document_id, locale)` primary key. An
   * empty array clears the set (advertise nothing). Shared by
   * `createDocumentVersion` (step 2b, create write path) and the standalone
   * `setDocumentAvailableLocales` command (the non-versioned admin
   * available-locales widget write). See docs/07-internationalization/index.md.
   */
  private async writeDocumentAvailableLocales(
    tx: TxConnection,
    args: { documentId: string; collectionId: string; availableLocales: string[] }
  ): Promise<void> {
    await tx
      .delete(documentAvailableLocales)
      .where(eq(documentAvailableLocales.document_id, args.documentId))
    const locales = [...new Set(args.availableLocales)]
    if (locales.length > 0) {
      await tx.insert(documentAvailableLocales).values(
        locales.map((locale) => ({
          document_id: args.documentId,
          locale,
          collection_id: args.collectionId,
        }))
      )
    }
  }

  /**
   * updateDocumentPath
   *
   * Standalone, non-versioned write of a document's URL path. Backs the admin
   * path widget's direct-write Save path: it edits `byline_document_paths`
   * in-place (document-grain, sticky) **without** minting a new document
   * version or touching workflow status. The path's document-grain nature means
   * the change is immediate and applies across every version of the document.
   *
   * Source-locale enforcement and `ERR_PATH_CONFLICT` mapping live in the
   * lifecycle service that calls this; the command itself only performs the
   * upsert (and surfaces the raw `23505` for the service to translate).
   */
  async updateDocumentPath(params: {
    documentId: string
    collectionId: string
    locale: string
    path: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.writeDocumentPath(tx, {
        documentId: params.documentId,
        locale: params.locale,
        collectionId: params.collectionId,
        path: params.path,
      })
    })
  }

  /**
   * setDocumentAvailableLocales
   *
   * Standalone, non-versioned write of a document's editorial advertised-locale
   * set. Backs the admin available-locales widget's direct-write Save path: it
   * replaces `byline_document_available_locales` wholesale (document-grain)
   * **without** minting a new document version or touching workflow status. The
   * change is immediate and applies across every version of the document; the
   * public advertised set remains the intersection with the resolved version's
   * completeness ledger. See docs/07-internationalization/index.md.
   */
  async setDocumentAvailableLocales(params: {
    documentId: string
    collectionId: string
    availableLocales: string[]
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.writeDocumentAvailableLocales(tx, {
        documentId: params.documentId,
        collectionId: params.collectionId,
        availableLocales: params.availableLocales,
      })
    })
  }

  /**
   * writeVersionLocaleLedger
   *
   * Compute and insert a version's `byline_document_version_locales` rows: a
   * locale is recorded when it covers every localized field path the version's
   * `sourceLocale` has (path-coverage), and a version with no localized content
   * records a single `'all'` sentinel. Reads the version's persisted store rows,
   * so callers must have written them first. Shared by the create write path
   * (step 6) and `reAnchorDocument` (which recomputes against the new source).
   * Assumes the version has no ledger rows yet (a freshly-inserted version).
   * See docs/07-internationalization/index.md.
   */
  private async writeVersionLocaleLedger(
    tx: TxConnection,
    versionId: string,
    sourceLocale: string
  ): Promise<void> {
    await tx.execute(sql`
      WITH loc AS (
        SELECT field_path, locale FROM byline_store_text     WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_numeric  WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_boolean  WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_datetime WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_file     WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_relation WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_json     WHERE document_version_id = ${versionId}::uuid AND locale <> 'all'
      ),
      canonical AS (
        SELECT field_path FROM loc WHERE locale = ${sourceLocale}
      ),
      covering AS (
        SELECT l.locale
        FROM loc l
        GROUP BY l.locale
        HAVING NOT EXISTS (
          SELECT 1 FROM canonical c
          WHERE NOT EXISTS (
            SELECT 1 FROM loc l2 WHERE l2.locale = l.locale AND l2.field_path = c.field_path
          )
        )
      )
      INSERT INTO byline_document_version_locales (document_version_id, locale)
      SELECT ${versionId}::uuid, locale FROM covering
      UNION ALL
      SELECT ${versionId}::uuid, 'all' WHERE NOT EXISTS (SELECT 1 FROM loc)
    `)
  }

  /**
   * copyAllVersionStoreRows
   *
   * Copy every store row — all eight tables, all locales, including the `meta`
   * identity rows (so block / array-item `_id`s are preserved) — from one
   * document version to another, verbatim. New `id`s are minted; the target
   * `document_version_id` is rebound; timestamps are refreshed. The target
   * version is assumed fresh (no rows), so no conflict handling is needed.
   * Used by `reAnchorDocument` to snapshot the current version into the new
   * re-anchored one without re-flattening (lossless, identity-preserving).
   *
   * When `excludeLocale` is provided, rows for that locale are skipped in the
   * seven value-store tables — the carry-forward that powers `deleteDocumentLocale`
   * (drop one locale's content, keep `'all'` + every other locale). The
   * locale-agnostic `byline_store_meta` rows (block / array-item identities) are
   * always copied wholesale, since a block's identity is shared across locales.
   */
  private async copyAllVersionStoreRows(
    tx: TxConnection,
    fromVersionId: string,
    toVersionId: string,
    excludeLocale?: string
  ): Promise<void> {
    const from = sql`${fromVersionId}::uuid`
    const to = sql`${toVersionId}::uuid`
    // Appended to each value-store WHERE so the dropped locale's rows are not
    // carried into the new version. Empty fragment (copy everything) when no
    // exclusion is requested — the `reAnchorDocument` snapshot path.
    const localeFilter = excludeLocale ? sql` AND locale <> ${excludeLocale}` : sql``

    await tx.execute(sql`
      INSERT INTO byline_store_text
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, word_count, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, value, word_count, NOW(), NOW()
      FROM byline_store_text WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_numeric
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, NOW(), NOW()
      FROM byline_store_numeric WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_boolean
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, value, NOW(), NOW()
      FROM byline_store_boolean WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_datetime
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, NOW(), NOW()
      FROM byline_store_datetime WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_json
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, NOW(), NOW()
      FROM byline_store_json WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_relation
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, NOW(), NOW()
      FROM byline_store_relation WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_file
        (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, NOW(), NOW()
      FROM byline_store_file WHERE document_version_id = ${from}${localeFilter}
    `)
    await tx.execute(sql`
      INSERT INTO byline_store_meta
        (id, document_version_id, collection_id, type, path, item_id, meta, created_at, updated_at)
      SELECT gen_random_uuid(), ${to}, collection_id, type, path, item_id, meta, NOW(), NOW()
      FROM byline_store_meta WHERE document_version_id = ${from}
    `)
  }

  /**
   * deleteDocumentLocale
   *
   * Remove one content locale's data from a document by writing a **new
   * immutable version** that carries forward every store row except the
   * target locale's (the `'all'` rows and all other locales are kept). The
   * prior version still holds the deleted locale, so the operation is
   * recoverable via version restore, and a previously-published version keeps
   * serving until the new version is published.
   *
   * The new version's status is supplied by the caller (the lifecycle service
   * passes the workflow's default — a fresh draft, matching `copyToLocale`).
   * The derived availability ledger is recomputed from the carried-forward
   * rows, so the deleted locale drops out automatically. The default content
   * locale (the document's anchor) must never be passed here — the lifecycle
   * service enforces that.
   *
   * Mirrors `reAnchorDocument`'s new-version mechanics; defensively returns
   * `null` when the document has no current version (the service validates
   * existence first, so this is a guard).
   */
  async deleteDocumentLocale(params: {
    documentId: string
    locale: string
    status?: string
    createdBy?: string
  }): Promise<{ newVersionId: string; previousVersionId: string } | null> {
    const { documentId, locale, status, createdBy } = params
    return this.db.transaction(async (tx) => {
      // 1. Current (latest, non-deleted) version + the document's anchor.
      const current = await tx
        .select({
          versionId: documentVersions.id,
          collectionId: documentVersions.collection_id,
          collectionVersion: documentVersions.collection_version,
          sourceLocale: documents.source_locale,
        })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.id, documentVersions.document_id))
        .where(
          and(eq(documentVersions.document_id, documentId), eq(documentVersions.is_deleted, false))
        )
        .orderBy(desc(documentVersions.id))
        .limit(1)
        .then((rows) => rows[0])

      if (current == null) return null

      const sourceLocale = current.sourceLocale ?? this.defaultContentLocale

      // 2. New immutable version: a snapshot of the current version with the
      //    target locale's value rows dropped (meta + 'all' + other locales
      //    carried forward).
      const newVersionId = uuidv7()
      await tx.insert(documentVersions).values({
        id: newVersionId,
        document_id: documentId,
        collection_id: current.collectionId,
        collection_version: current.collectionVersion,
        event_type: 'delete_locale',
        status: status ?? 'draft',
        change_summary: `deleted content locale ${locale}`,
        created_by: createdBy ?? null,
      })
      await this.copyAllVersionStoreRows(tx, current.versionId, newVersionId, locale)

      // 3. Recompute the new version's availability ledger against the source
      //    locale — the dropped locale no longer covers it, so it falls out.
      await this.writeVersionLocaleLedger(tx, newVersionId, sourceLocale)

      return { newVersionId, previousVersionId: current.versionId }
    })
  }

  /**
   * reAnchorDocument
   *
   * Change a single document's content source locale to `targetLocale` — its
   * fallback floor, path locale, and completeness yardstick. Refuses unless the
   * document is **complete** in the target (the current version's ledger covers
   * it, or the document is locale-agnostic) — never manufactures a primary
   * language with holes. In one transaction: flips `source_locale`, moves the
   * path row onto the new locale (keeping the slug), writes a **new version**
   * that is a verbatim copy of the current one (immutable version event,
   * identities preserved), and computes that version's ledger against the new
   * source. `dryRun` performs only the eligibility check and reports the
   * outcome that *would* result, writing nothing. See
   * docs/07-internationalization/index.md.
   */
  async reAnchorDocument(params: {
    documentId: string
    targetLocale: string
    dryRun?: boolean
    createdBy?: string
  }): Promise<ReAnchorResult> {
    const { documentId, targetLocale, dryRun = false, createdBy } = params
    return this.db.transaction(async (tx) => {
      // 1. Current (latest, non-deleted) version + the document's anchor.
      const current = await tx
        .select({
          versionId: documentVersions.id,
          collectionId: documentVersions.collection_id,
          collectionVersion: documentVersions.collection_version,
          status: documentVersions.status,
          sourceLocale: documents.source_locale,
        })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.id, documentVersions.document_id))
        .where(
          and(eq(documentVersions.document_id, documentId), eq(documentVersions.is_deleted, false))
        )
        .orderBy(desc(documentVersions.id))
        .limit(1)
        .then((rows) => rows[0])

      if (current == null) {
        return { documentId, status: 'not-found', toLocale: targetLocale }
      }

      const fromLocale = current.sourceLocale ?? this.defaultContentLocale
      if (fromLocale === targetLocale) {
        return { documentId, status: 'already-anchored', fromLocale, toLocale: targetLocale }
      }

      // 2. Eligibility: the current version must be complete in the target —
      //    its ledger contains the target locale, or it is locale-agnostic
      //    (the `'all'` sentinel → renders identically in any locale).
      const ledgerRows = await tx
        .select({ locale: documentVersionLocales.locale })
        .from(documentVersionLocales)
        .where(eq(documentVersionLocales.document_version_id, current.versionId))
      const ledger = new Set(ledgerRows.map((r) => r.locale))
      const complete = ledger.has(targetLocale) || ledger.has('all')
      if (!complete) {
        return { documentId, status: 'skipped-incomplete', fromLocale, toLocale: targetLocale }
      }

      if (dryRun) {
        return { documentId, status: 'reanchored', fromLocale, toLocale: targetLocale }
      }

      // 3. Flip the document's content anchor.
      await tx
        .update(documents)
        .set({ source_locale: targetLocale })
        .where(eq(documents.id, documentId))

      // 4. Move the path row onto the new source locale (re-tag the slug, do
      //    not regenerate it — the document's URL is unchanged).
      await tx
        .update(documentPaths)
        .set({ locale: targetLocale, updated_at: new Date() })
        .where(and(eq(documentPaths.document_id, documentId), eq(documentPaths.locale, fromLocale)))

      // 5. New immutable version: a verbatim snapshot of the current version.
      const newVersionId = uuidv7()
      await tx.insert(documentVersions).values({
        id: newVersionId,
        document_id: documentId,
        collection_id: current.collectionId,
        collection_version: current.collectionVersion,
        event_type: 'update',
        status: current.status ?? 'draft',
        change_summary: `re-anchored content source locale ${fromLocale} → ${targetLocale}`,
        created_by: createdBy ?? null,
      })
      await this.copyAllVersionStoreRows(tx, current.versionId, newVersionId)

      // 6. Ledger for the new version, computed against the new source locale.
      await this.writeVersionLocaleLedger(tx, newVersionId, targetLocale)

      return { documentId, status: 'reanchored', fromLocale, toLocale: targetLocale, newVersionId }
    })
  }

  /**
   * reAnchorDocuments
   *
   * Bulk re-anchor: walk every (non-deleted) logical document — optionally
   * scoped to one collection — and re-anchor each that is complete in
   * `targetLocale`, skipping (and reporting) the rest. Each document runs in its
   * own transaction via `reAnchorDocument`, so one failure or skip never rolls
   * back the others; the command is idempotent and resumable. This is the
   * "client switched the default content locale, move every fully-translated
   * document onto it" operation; the `skipped-incomplete` results double as the
   * outstanding-translation backlog. `dryRun` reports what would happen without
   * writing. See docs/07-internationalization/index.md.
   */
  async reAnchorDocuments(params: {
    targetLocale: string
    collectionId?: string
    dryRun?: boolean
  }): Promise<ReAnchorReport> {
    const { targetLocale, collectionId, dryRun = false } = params
    const conditions = [eq(documentVersions.is_deleted, false)]
    if (collectionId) {
      conditions.push(eq(documentVersions.collection_id, collectionId))
    }
    const docs = await this.db
      .selectDistinct({ documentId: documentVersions.document_id })
      .from(documentVersions)
      .where(and(...conditions))

    const report: ReAnchorReport = {
      targetLocale,
      dryRun,
      total: docs.length,
      reanchored: 0,
      skippedIncomplete: 0,
      alreadyAnchored: 0,
      notFound: 0,
      results: [],
    }
    for (const { documentId } of docs) {
      const result = await this.reAnchorDocument({ documentId, targetLocale, dryRun })
      report.results.push(result)
      switch (result.status) {
        case 'reanchored':
          report.reanchored++
          break
        case 'skipped-incomplete':
          report.skippedIncomplete++
          break
        case 'already-anchored':
          report.alreadyAnchored++
          break
        case 'not-found':
          report.notFound++
          break
      }
    }
    return report
  }

  /**
   * backfillVersionLocales
   *
   * One-time maintenance: populate `byline_document_version_locales` for
   * versions written *before* the ledger existed (i.e. before the migration
   * that added it). Going forward `createDocumentVersion` step 6 keeps the
   * ledger current; this fills the historical gap so `localeFallback:
   * 'strict'` reads can see pre-existing documents.
   *
   * Same path-coverage rule as the write path, applied set-wise across every
   * version in one statement. The `canonical` anchor is each document's own
   * `source_locale` (joined via `byline_document_versions` → `byline_documents`),
   * falling back to the adapter's configured default content locale for rows
   * not yet stamped by `backfillSourceLocales` — mirroring the per-document
   * anchor the write path uses, rather than a single global locale. Idempotent
   * — safe to re-run (PK + `ON CONFLICT DO NOTHING`); versions are immutable, so
   * a version's computed locale set never changes. Returns the number of
   * `(version, locale)` rows inserted.
   *
   * See docs/07-internationalization/index.md.
   */
  async backfillVersionLocales(): Promise<{ rowsInserted: number }> {
    const result = await this.db.execute(sql`
      WITH loc AS (
        SELECT document_version_id, field_path, locale FROM byline_store_text     WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_numeric  WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_boolean  WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_datetime WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_file     WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_relation WHERE locale <> 'all'
        UNION SELECT document_version_id, field_path, locale FROM byline_store_json     WHERE locale <> 'all'
      ),
      canonical AS (
        SELECT l.document_version_id, l.field_path
        FROM loc l
        JOIN byline_document_versions v ON v.id = l.document_version_id
        JOIN byline_documents d ON d.id = v.document_id
        WHERE l.locale = COALESCE(d.source_locale, ${this.defaultContentLocale})
      ),
      covering AS (
        SELECT l.document_version_id, l.locale
        FROM loc l
        GROUP BY l.document_version_id, l.locale
        HAVING NOT EXISTS (
          SELECT 1 FROM canonical c
          WHERE c.document_version_id = l.document_version_id
            AND NOT EXISTS (
              SELECT 1 FROM loc l2
              WHERE l2.document_version_id = l.document_version_id
                AND l2.locale = l.locale
                AND l2.field_path = c.field_path
            )
        )
      )
      INSERT INTO byline_document_version_locales (document_version_id, locale)
      SELECT document_version_id, locale FROM covering
      UNION ALL
      SELECT v.id, 'all' FROM byline_document_versions v
      WHERE NOT EXISTS (SELECT 1 FROM loc WHERE loc.document_version_id = v.id)
      ON CONFLICT DO NOTHING
    `)

    return { rowsInserted: result.rowCount ?? 0 }
  }

  /**
   * backfillSourceLocales
   *
   * One-time maintenance: stamp `byline_documents.source_locale` for documents
   * created *before* the column existed. Sets every row whose `source_locale`
   * is still NULL to the adapter's configured default content locale — the
   * anchor those documents were implicitly authored against (a static SQL
   * migration cannot know the configured default, mirroring
   * `backfillVersionLocales`). Idempotent: only touches NULL rows, so re-runs
   * and rows already stamped by the write path are left alone. Must run before
   * the follow-up migration that sets the column NOT NULL.
   *
   * Returns the number of document rows stamped.
   *
   * See docs/07-internationalization/index.md.
   */
  async backfillSourceLocales(): Promise<{ rowsUpdated: number }> {
    const result = await this.db
      .update(documents)
      .set({ source_locale: this.defaultContentLocale })
      .where(sql`${documents.source_locale} IS NULL`)
    return { rowsUpdated: (result as any).rowCount ?? 0 }
  }

  /**
   * setDocumentStatus
   *
   * Mutate the status field on an existing document version row.
   * This is the one case where we UPDATE a version in-place — status is
   * lifecycle metadata, not content.
   */
  async setDocumentStatus(params: { document_version_id: string; status: string }): Promise<void> {
    await this.db
      .update(documentVersions)
      .set({
        status: params.status,
        updated_at: new Date(),
      })
      .where(eq(documentVersions.id, params.document_version_id))
  }

  /**
   * archivePublishedVersions
   *
   * Set ALL versions of a document that currently have `currentStatus`
   * (defaults to 'published') to 'archived'. Optionally exclude a specific
   * version so the caller can protect the version it is about to publish.
   *
   * Returns the number of rows updated.
   */
  async archivePublishedVersions(params: {
    document_id: string
    currentStatus?: string
    excludeVersionId?: string
  }): Promise<number> {
    const targetStatus = params.currentStatus ?? 'published'
    const conditions = [
      eq(documentVersions.document_id, params.document_id),
      eq(documentVersions.status, targetStatus),
    ]
    if (params.excludeVersionId) {
      conditions.push(ne(documentVersions.id, params.excludeVersionId))
    }
    const result = await this.db
      .update(documentVersions)
      .set({ status: 'archived', updated_at: new Date() })
      .where(and(...conditions))
    return (result as any).rowCount ?? 0
  }

  /**
   * softDeleteDocument
   *
   * Mark ALL versions of a document as deleted by setting `is_deleted = true`.
   * The `current_documents` view filters these out, so the document disappears
   * from listings without physically removing data.
   *
   * Returns the number of version rows marked as deleted.
   */
  async softDeleteDocument(params: { document_id: string }): Promise<number> {
    return this.db.transaction(async (tx) => {
      // Tree placement takes this same collection lock before inspecting any
      // endpoint state. Taking it before document/version locks makes direct
      // soft deletion serialize with placement without reversing the normal
      // lifecycle delete's lock order.
      const collectionId = await this.lockDocumentCollection(tx, params.document_id)
      if (collectionId == null) return 0

      const [document] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, params.document_id))
        .for('update')
      if (document == null) return 0

      const result = await tx
        .update(documentVersions)
        .set({
          is_deleted: true,
          updated_at: new Date(),
        })
        .where(eq(documentVersions.document_id, params.document_id))
      return (result as any).rowCount ?? 0
    })
  }

  /**
   * Write `order_key` on a single `byline_documents` row. Single-column
   * metadata update — no new version row, no `documentVersions` touch.
   * `updated_at` on the document row is bumped so list caches invalidate.
   */
  async setOrderKey(params: { document_id: string; order_key: string }): Promise<void> {
    await this.db
      .update(documents)
      .set({
        order_key: params.order_key,
        updated_at: new Date(),
      })
      .where(eq(documents.id, params.document_id))
  }

  /** Serialize structural changes per collection and verify the collection exists. */
  private async lockTreeCollection(tx: TxConnection, collectionId: string): Promise<void> {
    const locked = await tx.execute(sql`
      SELECT id FROM byline_collections
      WHERE id = ${collectionId}::uuid
      FOR UPDATE
    `)
    if (locked.rows.length === 0) {
      throw ERR_NOT_FOUND({ message: 'collection not found', details: { collectionId } })
    }
  }

  /** Resolve a document's collection while locking only the collection row. */
  private async lockDocumentCollection(
    tx: TxConnection,
    documentId: string
  ): Promise<string | null> {
    const locked = await tx.execute(sql`
      SELECT c.id AS collection_id
      FROM byline_collections c
      JOIN byline_documents d ON d.collection_id = c.id
      WHERE d.id = ${documentId}::uuid
      FOR UPDATE OF c
    `)
    return (locked.rows[0]?.collection_id as string | undefined) ?? null
  }

  /** Read one ordered sibling group on the already collection-locked transaction. */
  private async treeGroup(
    tx: TxConnection,
    collectionId: string,
    parentDocumentId: string | null
  ): Promise<Array<{ documentId: string; orderKey: string }>> {
    const rows = await tx
      .select({
        documentId: documentRelationships.child_document_id,
        orderKey: documentRelationships.order_key,
      })
      .from(documentRelationships)
      .innerJoin(documents, eq(documents.id, documentRelationships.child_document_id))
      .where(
        and(
          eq(documents.collection_id, collectionId),
          parentDocumentId == null
            ? sql`${documentRelationships.parent_document_id} IS NULL`
            : eq(documentRelationships.parent_document_id, parentDocumentId)
        )
      )
      .orderBy(documentRelationships.order_key)
    return rows
  }

  /** Read a node's placement from the already collection-locked transaction. */
  private async treePlacement(
    tx: TxConnection,
    collectionId: string,
    documentId: string
  ): Promise<{
    state: TreePlacementState
    siblings: Array<{ documentId: string; orderKey: string }>
  }> {
    const [edge] = await tx
      .select({
        parentDocumentId: documentRelationships.parent_document_id,
        orderKey: documentRelationships.order_key,
      })
      .from(documentRelationships)
      .where(eq(documentRelationships.child_document_id, documentId))
      .limit(1)
    if (edge == null) {
      return {
        state: { placed: false, parentDocumentId: null, orderKey: null, index: null },
        siblings: [],
      }
    }
    const siblings = await this.treeGroup(tx, collectionId, edge.parentDocumentId)
    const index = siblings.findIndex((row) => row.documentId === documentId)
    return {
      state: {
        placed: true,
        parentDocumentId: edge.parentDocumentId,
        orderKey: edge.orderKey,
        index: index >= 0 ? index : null,
      },
      siblings,
    }
  }

  /** Read a raw node-and-descendants set while the collection tree lock is held. */
  private async treeSubtreeIds(
    tx: TxConnection,
    collectionId: string,
    documentId: string
  ): Promise<string[]> {
    const result = await tx.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT d.id AS document_id, 0 AS depth
        FROM byline_documents d
        WHERE d.id = ${documentId}::uuid
          AND d.collection_id = ${collectionId}::uuid
        UNION ALL
        SELECT r.child_document_id, s.depth + 1
        FROM byline_document_relationships r
        JOIN subtree s ON r.parent_document_id = s.document_id
        JOIN byline_documents d ON d.id = r.child_document_id
        WHERE d.collection_id = ${collectionId}::uuid
          AND s.depth < ${TREE_MAX_DEPTH}
      )
      SELECT document_id FROM subtree ORDER BY depth
    `)
    return result.rows.map((row) => row.document_id as string)
  }

  /**
   * placeTreeNode — see {@link IDocumentCommands.placeTreeNode}.
   *
   * Single transaction: same-collection guard → cycle guard → resolve the
   * target sibling group's neighbour keys → mint a fractional key → upsert the
   * edge row (conflict on `child_document_id`, the single-parent invariant).
   * Unversioned; touches only `byline_document_relationships`.
   */
  async placeTreeNode(params: {
    collectionId: string
    documentId: string
    parentDocumentId: string | null
    beforeDocumentId?: string | null
    afterDocumentId?: string | null
    ifUnplaced?: boolean
  }): Promise<TreeMutationResult> {
    const { collectionId, documentId, parentDocumentId } = params
    const beforeDocumentId = params.beforeDocumentId ?? null
    const afterDocumentId = params.afterDocumentId ?? null

    if (parentDocumentId === documentId) {
      throw ERR_VALIDATION({
        message: 'a document cannot be its own parent in the document tree',
        details: { documentId },
      })
    }
    if (beforeDocumentId === documentId || afterDocumentId === documentId) {
      throw ERR_VALIDATION({
        message: 'a document cannot be its own tree neighbour',
        details: { documentId },
      })
    }
    if (beforeDocumentId != null && beforeDocumentId === afterDocumentId) {
      throw ERR_VALIDATION({
        message: 'beforeDocumentId and afterDocumentId must identify different tree neighbours',
        details: { documentId, beforeDocumentId, afterDocumentId },
      })
    }

    return await this.db.transaction(async (tx) => {
      // One collection-row lock serializes all edge and sibling-key changes in
      // the tree, so the returned before state and no-op decision cannot race.
      await this.lockTreeCollection(tx, collectionId)

      // Same-collection guard — every supplied endpoint must live in `collectionId`.
      const ids = [documentId, parentDocumentId, beforeDocumentId, afterDocumentId].filter(
        (id): id is string => id != null
      )
      const docRows = await tx
        .select({ id: documents.id, collection_id: documents.collection_id })
        .from(documents)
        .where(inArray(documents.id, ids))
      const collectionById = new Map(docRows.map((r) => [r.id, r.collection_id]))

      if (collectionById.get(documentId) == null) {
        throw ERR_NOT_FOUND({ message: 'document not found', details: { documentId } })
      }
      if (collectionById.get(documentId) !== collectionId) {
        throw ERR_VALIDATION({
          message: 'document does not belong to the collection',
          details: { documentId, collectionId },
        })
      }

      if (parentDocumentId != null) {
        if (collectionById.get(parentDocumentId) == null) {
          throw ERR_NOT_FOUND({
            message: 'parent document not found',
            details: { parentDocumentId },
          })
        }
        if (collectionById.get(parentDocumentId) !== collectionId) {
          throw ERR_VALIDATION({
            message: 'parent document is in a different collection',
            details: { parentDocumentId, collectionId },
          })
        }
      }

      const neighbours = [
        { role: 'beforeDocumentId', id: beforeDocumentId },
        { role: 'afterDocumentId', id: afterDocumentId },
      ] as const
      for (const neighbour of neighbours) {
        if (neighbour.id == null) continue
        if (collectionById.get(neighbour.id) == null) {
          throw ERR_NOT_FOUND({
            message: 'tree neighbour document not found',
            details: { documentId, [neighbour.role]: neighbour.id },
          })
        }
        if (collectionById.get(neighbour.id) !== collectionId) {
          throw ERR_VALIDATION({
            message: 'tree neighbour is in a different collection',
            details: { documentId, collectionId, [neighbour.role]: neighbour.id },
          })
        }
      }

      const liveRows = await tx
        .select({ id: currentDocumentsView.document_id })
        .from(currentDocumentsView)
        .where(
          and(
            eq(currentDocumentsView.collection_id, collectionId),
            inArray(currentDocumentsView.document_id, ids)
          )
        )
      const liveIds = new Set(liveRows.map((row) => row.id))
      if (!liveIds.has(documentId)) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage('document no longer has a current version'),
          details: { documentId, collectionId },
        })
      }
      if (parentDocumentId != null && !liveIds.has(parentDocumentId)) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage('parent no longer has a current version'),
          details: { documentId, parentDocumentId, collectionId },
        })
      }
      for (const neighbour of neighbours) {
        if (neighbour.id != null && !liveIds.has(neighbour.id)) {
          throw ERR_CONFLICT({
            message: staleTreePlacementMessage(`${neighbour.role} no longer has a current version`),
            details: { documentId, collectionId, [neighbour.role]: neighbour.id },
          })
        }
      }

      if (parentDocumentId != null) {
        // Cycle guard — reject when `documentId` is the new parent itself or
        // any of its ancestors (which would put the node below its own
        // subtree). Walk upward from `parentDocumentId`; depth-bounded.
        const cycle = await tx.execute(sql`
          WITH RECURSIVE chain AS (
            SELECT ${parentDocumentId}::uuid AS node_id, 0 AS depth
            UNION ALL
            SELECT r.parent_document_id, c.depth + 1
            FROM byline_document_relationships r
            JOIN chain c ON r.child_document_id = c.node_id
            WHERE r.parent_document_id IS NOT NULL AND c.depth < ${TREE_MAX_DEPTH}
          )
          SELECT 1 FROM chain WHERE node_id = ${documentId}::uuid LIMIT 1
        `)
        if (cycle.rows.length > 0) {
          throw ERR_VALIDATION({
            message: 'move would create a cycle in the document tree',
            details: { documentId, parentDocumentId },
          })
        }
      }

      const before = await this.treePlacement(tx, collectionId, documentId)
      if (params.ifUnplaced === true && before.state.placed) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: before.siblings.map((row) => row.documentId),
          beforeSubtreeDocumentIds: [],
        }
      }
      const targetGroup = (
        before.state.placed && before.state.parentDocumentId === parentDocumentId
          ? before.siblings
          : await this.treeGroup(tx, collectionId, parentDocumentId)
      ).filter((row) => row.documentId !== documentId)

      const leftIndex = beforeDocumentId
        ? targetGroup.findIndex((row) => row.documentId === beforeDocumentId)
        : -1
      const rightIndex = afterDocumentId
        ? targetGroup.findIndex((row) => row.documentId === afterDocumentId)
        : -1
      if (beforeDocumentId && leftIndex < 0) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage(
            'beforeDocumentId is no longer in the target sibling group'
          ),
          details: { documentId, parentDocumentId, beforeDocumentId },
        })
      }
      if (afterDocumentId && rightIndex < 0) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage(
            'afterDocumentId is no longer in the target sibling group'
          ),
          details: { documentId, parentDocumentId, afterDocumentId },
        })
      }
      if (afterDocumentId && beforeDocumentId == null && rightIndex !== 0) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage('right neighbour is no longer first'),
          details: { documentId, parentDocumentId, afterDocumentId },
        })
      }
      if (beforeDocumentId && afterDocumentId == null && leftIndex !== targetGroup.length - 1) {
        throw ERR_CONFLICT({
          message: staleTreePlacementMessage('left neighbour is no longer last'),
          details: { documentId, parentDocumentId, beforeDocumentId },
        })
      }

      let insertionIndex: number
      if (beforeDocumentId && afterDocumentId) {
        if (leftIndex + 1 !== rightIndex) {
          throw ERR_CONFLICT({
            message: staleTreePlacementMessage('target neighbours are no longer adjacent'),
            details: { documentId, parentDocumentId, beforeDocumentId, afterDocumentId },
          })
        }
        insertionIndex = rightIndex
      } else if (beforeDocumentId) {
        insertionIndex = leftIndex + 1
      } else if (afterDocumentId) {
        insertionIndex = rightIndex
      } else {
        insertionIndex = targetGroup.length
      }

      if (
        before.state.placed &&
        before.state.parentDocumentId === parentDocumentId &&
        before.state.index === insertionIndex
      ) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: before.siblings.map((row) => row.documentId),
          beforeSubtreeDocumentIds: [],
        }
      }

      const left = targetGroup[insertionIndex - 1]?.orderKey ?? null
      const right = targetGroup[insertionIndex]?.orderKey ?? null

      let orderKey: string
      try {
        orderKey = generateKeyBetween(left, right)
      } catch (err) {
        throw ERR_VALIDATION({
          message: 'cannot generate order_key between the supplied tree neighbours',
          details: {
            documentId,
            parentDocumentId,
            left,
            right,
            cause: err instanceof Error ? err.message : String(err),
          },
        })
      }

      await tx
        .insert(documentRelationships)
        .values({
          child_document_id: documentId,
          parent_document_id: parentDocumentId,
          order_key: orderKey,
        })
        .onConflictDoUpdate({
          target: documentRelationships.child_document_id,
          set: {
            parent_document_id: parentDocumentId,
            order_key: orderKey,
            updated_at: new Date(),
          },
        })

      return {
        changed: true,
        before: before.state,
        after: {
          placed: true,
          parentDocumentId,
          orderKey,
          index: insertionIndex,
        },
        beforeSiblingDocumentIds: before.siblings.map((row) => row.documentId),
        beforeSubtreeDocumentIds: [],
      }
    })
  }

  /**
   * removeFromTree — see {@link IDocumentCommands.removeFromTree}.
   * Single-row delete; no-op when the node is already unplaced.
   */
  async removeFromTree(params: {
    collectionId: string
    documentId: string
    includeSubtree?: boolean
  }): Promise<TreeMutationResult> {
    return this.db.transaction(async (tx) => {
      await this.lockTreeCollection(tx, params.collectionId)
      const [document] = await tx
        .select({ collectionId: documents.collection_id })
        .from(documents)
        .where(eq(documents.id, params.documentId))
        .limit(1)
      if (document == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        })
      }
      if (document.collectionId !== params.collectionId) {
        throw ERR_VALIDATION({
          message: 'document does not belong to the collection',
          details: params,
        })
      }
      const before = await this.treePlacement(tx, params.collectionId, params.documentId)
      const beforeSubtreeDocumentIds = params.includeSubtree
        ? await this.treeSubtreeIds(tx, params.collectionId, params.documentId)
        : []
      if (!before.state.placed) {
        return {
          changed: false,
          before: before.state,
          after: before.state,
          beforeSiblingDocumentIds: [],
          beforeSubtreeDocumentIds,
        }
      }
      await tx
        .delete(documentRelationships)
        .where(eq(documentRelationships.child_document_id, params.documentId))
      return {
        changed: true,
        before: before.state,
        after: { placed: false, parentDocumentId: null, orderKey: null, index: null },
        beforeSiblingDocumentIds: before.siblings.map((row) => row.documentId),
        beforeSubtreeDocumentIds,
      }
    })
  }

  /** Promote direct children to roots and remove the parent edge under one lock. */
  async promoteChildrenAndRemoveFromTree(params: {
    collectionId: string
    documentId: string
  }): Promise<TreeDeleteMutationResult> {
    return this.db.transaction(async (tx) => {
      await this.lockTreeCollection(tx, params.collectionId)
      const [document] = await tx
        .select({ id: documents.id, collectionId: documents.collection_id })
        .from(documents)
        .where(eq(documents.id, params.documentId))
        .limit(1)
      if (document == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        })
      }
      if (document.collectionId !== params.collectionId) {
        throw ERR_VALIDATION({
          message: 'document does not belong to the collection',
          details: params,
        })
      }

      const parent = await this.treePlacement(tx, params.collectionId, params.documentId)
      const children = await this.treeGroup(tx, params.collectionId, params.documentId)
      const roots = (await this.treeGroup(tx, params.collectionId, null)).filter(
        (row) => row.documentId !== params.documentId
      )
      const promoted: TreeDeleteMutationResult['promoted'] = []

      for (const [index, child] of children.entries()) {
        const orderKey = generateKeyBetween(roots.at(-1)?.orderKey ?? null, null)
        const after: TreePlacementState = {
          placed: true,
          parentDocumentId: null,
          orderKey,
          index: roots.length,
        }
        await tx
          .update(documentRelationships)
          .set({ parent_document_id: null, order_key: orderKey, updated_at: new Date() })
          .where(eq(documentRelationships.child_document_id, child.documentId))
        promoted.push({
          documentId: child.documentId,
          before: {
            placed: true,
            parentDocumentId: params.documentId,
            orderKey: child.orderKey,
            index,
          },
          after,
        })
        roots.push({ documentId: child.documentId, orderKey })
      }

      if (parent.state.placed) {
        await tx
          .delete(documentRelationships)
          .where(eq(documentRelationships.child_document_id, params.documentId))
      }
      return {
        removed: {
          changed: parent.state.placed,
          before: parent.state,
          after: { placed: false, parentDocumentId: null, orderKey: null, index: null },
          beforeSiblingDocumentIds: parent.siblings.map((row) => row.documentId),
          beforeSubtreeDocumentIds: [],
        },
        promoted,
      }
    })
  }
}

export function createCommandBuilders(dbManager: DBManager, defaultContentLocale: string) {
  return {
    collections: new CollectionCommands(dbManager),
    documents: new DocumentCommands(dbManager, defaultContentLocale),
  }
}
