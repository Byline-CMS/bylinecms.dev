/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, ICollectionCommands, IDocumentCommands } from '@byline/core'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import {
  booleanStore,
  collections,
  datetimeStore,
  documentAvailableLocales,
  documentPaths,
  documents,
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

type DatabaseConnection = NodePgDatabase<typeof schema>

/**
 * CollectionCommands
 */
export class CollectionCommands implements ICollectionCommands {
  constructor(private db: DatabaseConnection) {}

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
    private db: DatabaseConnection,
    private defaultContentLocale: string
  ) {}

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
     * locale. See docs/AVAILABLE-LOCALES.md.
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
      // See docs/DEFAULT-LOCALE-SWITCHING.md.
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
        await tx
          .insert(documentPaths)
          .values({
            document_id: documentId,
            locale: sourceLocale,
            collection_id: params.collectionId,
            path: params.path,
          })
          .onConflictDoUpdate({
            target: [documentPaths.document_id, documentPaths.locale],
            set: {
              path: params.path,
              collection_id: params.collectionId,
              updated_at: new Date(),
            },
          })
      }

      // 2b. Replace the document_available_locales rows when an editorial set
      // is supplied. Document-grain and sticky across versions: `undefined`
      // leaves the existing set untouched (the lifecycle omits the param on
      // saves that don't touch advertising), while an explicit array — empty
      // included — replaces it wholesale. Deduplicated so a caller-supplied
      // duplicate doesn't collide on the (document_id, locale) primary key.
      if (params.availableLocales !== undefined) {
        await tx
          .delete(documentAvailableLocales)
          .where(eq(documentAvailableLocales.document_id, documentId))
        const locales = [...new Set(params.availableLocales)]
        if (locales.length > 0) {
          await tx.insert(documentAvailableLocales).values(
            locales.map((locale) => ({
              document_id: documentId,
              locale,
              collection_id: params.collectionId,
            }))
          )
        }
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
      // locale). Status-blind by design — see docs/CONTENT-LOCALE-RESOLUTION.md.
      const versionId = documentVersion.id
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

      return {
        document: documentVersion,
        fieldCount: flattenedFields.length,
      }
    })
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
   * See docs/CONTENT-LOCALE-RESOLUTION.md.
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
   * See docs/DEFAULT-LOCALE-SWITCHING.md.
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
    const result = await this.db
      .update(documentVersions)
      .set({
        is_deleted: true,
        updated_at: new Date(),
      })
      .where(eq(documentVersions.document_id, params.document_id))
    return (result as any).rowCount ?? 0
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
}

export function createCommandBuilders(db: DatabaseConnection, defaultContentLocale: string) {
  return {
    collections: new CollectionCommands(db),
    documents: new DocumentCommands(db, defaultContentLocale),
  }
}
