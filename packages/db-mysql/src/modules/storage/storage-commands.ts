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
  DbErrorCodes,
  ERR_CONFLICT,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  flattenFieldSetData,
  generateKeyBetween,
  TREE_PLACEMENT_STALE_MARKER,
} from '@byline/core'
import { and, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import type { AnyMySqlTable } from 'drizzle-orm/mysql-core'
import type { MySql2Database } from 'drizzle-orm/mysql2'
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
  documentVersions,
  fileStore,
  jsonStore,
  metaStore,
  numericStore,
  relationStore,
  textStore,
} from '../../database/schema/index.js'
import { classifyError } from './classify-error.js'
import { prepareFieldInsertBuckets } from './storage-insert.js'
import { affectedRowCount, getFirstOrThrow } from './storage-utils.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>
/** The transaction handle passed to `this.db.transaction(async (tx) => …)`. */
type TxConnection = Parameters<Parameters<DatabaseConnection['transaction']>[0]>[0]

/**
 * Depth backstop for the document-tree recursive walks (cycle guard, ancestor
 * walk). The write-path cycle guard prevents true cycles, so this only bounds
 * recursion against pre-existing pathological state — far deeper than any real
 * documentation hierarchy. Mirrors `packages/db-postgres/src/modules/storage/
 * storage-commands.ts`. See docs/04-collections/04-document-trees.md.
 */
const TREE_MAX_DEPTH = 10_000

const staleTreePlacementMessage = (message: string): string =>
  `${TREE_PLACEMENT_STALE_MARKER} tree placement is stale: ${message}`

/**
 * CollectionCommands
 *
 * Mirrors `packages/db-postgres/src/modules/storage/storage-commands.ts`'s
 * `CollectionCommands`. MySQL has no `RETURNING` clause, so every write
 * constructs its return value in JS instead — collection ids are
 * app-generated UUIDv7, so `create` already knows every value it needs
 * without a round trip. `update` re-`SELECT`s because `patch` is partial
 * and the caller expects the merged row back.
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
    const id = uuidv7()
    const version = opts?.version ?? 1
    const singular = config.labels.singular || path
    const plural = config.labels.plural || `${path}s`
    // `created_at`/`updated_at` are written explicitly rather than left to
    // the column's `DEFAULT CURRENT_TIMESTAMP(6)` — an earlier version of
    // this method approximated them with a request-time `Date` instead
    // (reasoning: "no caller in this adapter's current scope depends on
    // the authoritative value"), which is the exact reasoning that held for
    // `DocumentCommands.createDocumentVersion` right up until a
    // `db-conformance` fixture started windowing on `created_at` and an
    // intermittent few-millisecond gap between the app-side capture and the
    // DB-side `CURRENT_TIMESTAMP(6)` evaluation turned into a real flake —
    // see that method's `created_at`/`updated_at` comment below for the
    // live-server evidence. Writing the same `Date` instance to the column
    // that gets returned makes the two identical by construction instead of
    // two independent clock reads that can drift under load.
    const now = new Date()
    await this.db.insert(collections).values({
      id,
      path,
      singular,
      plural,
      config,
      version,
      created_at: now,
      updated_at: now,
      ...(opts?.schemaHash !== undefined ? { schema_hash: opts.schemaHash } : {}),
    })
    // `.returning()` has no MySQL equivalent — every value here is already
    // known (app-generated id, caller-supplied config, and the `created_at`
    // / `updated_at` just written above), so the row is constructed in JS
    // rather than re-`SELECT`ed.
    return [
      {
        id,
        path,
        singular,
        plural,
        config,
        version,
        schema_hash: opts?.schemaHash ?? null,
        created_at: now,
        updated_at: now,
      },
    ]
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
    await this.db.update(collections).set(set).where(eq(collections.id, id))
    // MySQL has no `RETURNING` — re-`SELECT` the merged row since `patch` is
    // partial and the caller expects the full row back.
    const row = await this.db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
      .then(getFirstOrThrow('Failed to load collection after update'))
    return [row]
  }

  async delete(id: string) {
    return await this.db.delete(collections).where(eq(collections.id, id))
  }
}

/**
 * DocumentCommands
 *
 * Ported from `packages/db-postgres/src/modules/storage/storage-commands.ts`'s
 * `DocumentCommands`. Task 9A landed `createDocumentVersion` and its private
 * helpers; Task 9B (this task) ports the rest of the write surface —
 * `updateDocumentPath`, `setDocumentAvailableLocales`, `setDocumentStatus`,
 * `archivePublishedVersions`, `softDeleteDocument`, `deleteDocumentLocale`,
 * `setOrderKey`, `placeTreeNode`, `removeFromTree`, and
 * `promoteChildrenAndRemoveFromTree` — completing `IDocumentCommands`. The
 * pg source's `reAnchorDocument` / `reAnchorDocuments` / `backfillVersionLocales`
 * are deliberately NOT ported here: `@byline/db-conformance`'s own suites
 * (`document-paths.ts`, `locale-fallback.ts`) document them as "Postgres-only
 * maintenance operations documented as off the core `IDbAdapter` contract" —
 * not something a conforming adapter is required to implement, and neither is
 * a member of `IDocumentCommands`.
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
   * Creates a new document or a new version of an existing document. Ported
   * from `packages/db-postgres/src/modules/storage/storage-commands.ts`'s
   * `DocumentCommands.createDocumentVersion` — see spec §2's normative
   * conversion table, applied at each site below:
   *
   *   - `.returning()` → construct-in-JS. Every id here is app-generated
   *     UUIDv7 (minted before the insert), so the value is already known —
   *     no re-`SELECT` is needed anywhere in this method.
   *   - `onConflictDoUpdate` (path upsert) → NOT `.onDuplicateKeyUpdate()`
   *     (found live: MySQL's `ON DUPLICATE KEY UPDATE` has no per-constraint
   *     targeting the way pg's `onConflictDoUpdate({ target })` does, so it
   *     would silently absorb a genuine cross-document path conflict instead
   *     of erroring). `writeDocumentPath` below does the targeting itself —
   *     see its docblock.
   *   - `ON CONFLICT (document_version_id, field_path, locale) DO NOTHING`
   *     (7 sites, the per-locale carry-forward) → MySQL has no per-row
   *     `gen_random_uuid()` to call from an `INSERT … SELECT`, and ids must
   *     be app-generated UUIDv7 — never `INSERT IGNORE`, which would swallow
   *     unrelated errors, and never a DB-generated id. So each site becomes
   *     a typed `SELECT` of the previous version's carry-forward rows,
   *     followed by a JS-side UUIDv7-per-row bulk `INSERT … ON DUPLICATE KEY
   *     UPDATE id = id` (drizzle's own documented no-op idiom for "do
   *     nothing" on MySQL) — see `copyForwardStoreRows` below, which the 7
   *     call sites share.
   *   - `::uuid` casts → dropped (MySQL ids are plain `CHAR(36)`).
   *
   * @param params - Options for creating the document
   * @returns The created document and the number of field values inserted
   */
  async createDocumentVersion(params: {
    documentId?: string
    collectionId: string
    collectionVersion: number
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    path?: string
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
      // See docs/08-internationalization/index.md.
      let sourceLocale: string
      if (documentId == null) {
        documentId = uuidv7()
        sourceLocale = this.defaultContentLocale
        await tx.insert(documents).values({
          id: documentId,
          collection_id: params.collectionId,
          order_key: params.orderKey ?? null,
          source_locale: sourceLocale,
        })
      } else {
        const existing = await tx
          .select({ source_locale: documents.source_locale })
          .from(documents)
          .where(eq(documents.id, documentId))
          .for('update')
          .then(getFirstOrThrow('Failed to load document for new version'))

        const versionLiveness = await this.readDocumentVersionLiveness(tx, documentId)
        if (versionLiveness.total > 0 && versionLiveness.live === 0) {
          throw ERR_CONFLICT({
            message: 'cannot add a version to a soft-deleted document',
            details: { documentId },
          })
        }
        sourceLocale = existing.source_locale ?? this.defaultContentLocale
      }

      // 2. Create the document version. The id is minted here (app-side
      // UUIDv7), so the row is constructed in JS below rather than
      // re-`SELECT`ed — MySQL has no `RETURNING`.
      //
      // `created_at`/`updated_at` are passed explicitly rather than left to
      // the column's `DEFAULT CURRENT_TIMESTAMP(6)` — the same explicit-write
      // fix `CollectionCommands.create` above now also carries, for the same
      // underlying reason it was found here first: `occurred_at` on this row
      // is a value the shared `db-conformance` audit activity-feed fixture
      // (and any other caller windowing on `created_at`) treats as
      // authoritative to derive query boundaries from the very `Date` this
      // method returns. Leaving the column to the DB default means the
      // *returned* timestamp (captured here, before the INSERT is even sent)
      // and the *persisted* timestamp (evaluated by the MySQL server when the
      // statement executes) are two independent clock reads that can diverge
      // under load — confirmed live: under CPU contention this measured a
      // 1–6ms gap between the two, enough to push a boundary row outside an
      // inclusive `<=` window derived from the approximated value and
      // intermittently fail `filters by date range on occurred_at`
      // (`packages/db-conformance/src/suites/audit.ts`). Writing the same
      // `Date` instance to the column that gets returned makes the two
      // identical by construction — there is no longer a second clock to
      // drift against.
      const documentVersionId = uuidv7()
      const createdAt = new Date()
      await tx.insert(documentVersions).values({
        id: documentVersionId,
        document_id: documentId,
        collection_id: params.collectionId,
        collection_version: params.collectionVersion,
        event_type: params.action ?? 'create',
        status: params.status ?? 'draft',
        created_by: params.createdBy ?? null,
        created_at: createdAt,
        updated_at: createdAt,
      })
      const documentVersion = {
        id: documentVersionId,
        document_id: documentId,
        collection_id: params.collectionId,
        collection_version: params.collectionVersion,
        doc: null,
        event_type: params.action ?? 'create',
        status: params.status ?? 'draft',
        is_deleted: false,
        created_by: params.createdBy ?? null,
        change_summary: null,
        created_at: createdAt,
        updated_at: createdAt,
      }

      // 2a. Upsert the document_paths row when a path is supplied. The path
      // row lives under the document's `source_locale` (its data anchor),
      // not the mutable global default — so a re-anchored document, or any
      // document read after the global default is switched, still resolves by
      // path. The lifecycle layer skips this param for non-source-locale
      // (translation) saves. Unique-constraint violations on
      // (collection_id, locale, path) bubble up as a MySQL ER_DUP_ENTRY error
      // which the lifecycle wraps as ERR_PATH_CONFLICT (via `classifyError`).
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
      // per-locale content is not lost under immutable versioning. Seven store
      // tables, one `copyForwardStoreRows` call each — see the method doc for
      // why this isn't a single `INSERT … SELECT` the way pg does it.
      if (params.previousVersionId && params.locale && params.locale !== 'all') {
        const prevId = params.previousVersionId
        const newId = documentVersion.id
        const activeLoc = params.locale

        await this.copyForwardStoreRows(tx, textStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, numericStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, booleanStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, datetimeStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, jsonStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, relationStore, prevId, newId, activeLoc)
        await this.copyForwardStoreRows(tx, fileStore, prevId, newId, activeLoc)
      }

      // 6. Record the version's available content locales for
      // `localeFallback: 'strict'` reads. A locale is "available" when it
      // covers every localized field path the default content locale has
      // (path-coverage). Derived from the *persisted* localized rows, so it
      // accounts for the per-locale carry-forward in step 5 — not just the
      // freshly-flattened locale. A version with no localized content at all
      // records a single `'all'` sentinel (it renders identically in any
      // locale). Status-blind by design — see docs/08-internationalization/index.md.
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
   * default.
   *
   * Real dialect divergence from pg, found live (a test that should have
   * raised a conflict silently "succeeded" instead): pg's `onConflictDoUpdate`
   * takes an explicit `target` — the (`document_id`, `locale`) unique index —
   * so a collision on the *other* unique index
   * (`idx_document_paths_collection_locale_path`, a genuine path conflict
   * from a different document) is deliberately left untargeted and bubbles up
   * as `23505`. MySQL's `ON DUPLICATE KEY UPDATE` has no per-constraint
   * targeting — it fires for a collision on *any* unique/primary key on the
   * table, so a naive `.onDuplicateKeyUpdate()` would silently rewrite
   * whichever existing row the *other* document's path collided with instead
   * of raising `ER_DUP_ENTRY`. So this does the targeting itself: try the
   * `INSERT` first; if it fails on the *own-document* unique index
   * (`unique_document_paths_document_locale`, the ordinary "this document is
   * resaving its already-anchored path" case — detected via `classifyError`,
   * the same cause-chain-walking classifier the lifecycle layer uses, since
   * mysql2/Drizzle wraps the duplicate-key error rather than throwing it
   * bare), fall through to an explicit `UPDATE` instead. Any other
   * duplicate-key error — in particular the collection-scoped
   * path-uniqueness index — is rethrown unchanged, so it still surfaces as
   * `ER_DUP_ENTRY` for the lifecycle layer's own `classifyError`-based
   * `ERR_PATH_CONFLICT` mapping.
   */
  private async writeDocumentPath(
    tx: TxConnection,
    args: { documentId: string; locale: string; collectionId: string; path: string }
  ): Promise<void> {
    try {
      await tx.insert(documentPaths).values({
        document_id: args.documentId,
        locale: args.locale,
        collection_id: args.collectionId,
        path: args.path,
      })
    } catch (err) {
      const classification = classifyError(err)
      const isOwnDocumentLocaleConflict =
        classification.code === DbErrorCodes.UNIQUE_VIOLATION &&
        classification.constraint === 'unique_document_paths_document_locale'
      if (!isOwnDocumentLocaleConflict) {
        throw err
      }
      await tx
        .update(documentPaths)
        .set({
          path: args.path,
          collection_id: args.collectionId,
          updated_at: new Date(),
        })
        .where(
          and(eq(documentPaths.document_id, args.documentId), eq(documentPaths.locale, args.locale))
        )
    }
  }

  /**
   * writeDocumentAvailableLocales
   *
   * Replace a document's `byline_document_available_locales` rows wholesale —
   * the editorial advertised-locale set. Document-grain and sticky across
   * versions: `delete`-then-`insert`, deduplicated so a caller-supplied
   * duplicate doesn't collide on the `(document_id, locale)` primary key. An
   * empty array clears the set (advertise nothing).
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
   * writeVersionLocaleLedger
   *
   * Compute and insert a version's `byline_document_version_locales` rows: a
   * locale is recorded when it covers every localized field path the version's
   * `sourceLocale` has (path-coverage), and a version with no localized content
   * records a single `'all'` sentinel. Reads the version's persisted store rows,
   * so callers must have written them first. `::uuid` casts are dropped
   * (MySQL ids are plain `CHAR(36)`); the WITH/UNION/HAVING NOT EXISTS logic is
   * otherwise unchanged MySQL 8+ syntax — but the WITH clause's *position* is a
   * real dialect difference, found live (a syntax error, not assumed): Postgres
   * accepts `WITH … INSERT INTO … SELECT …`, whereas MySQL requires the WITH
   * clause *after* `INSERT INTO <table>` and immediately before the `SELECT`
   * it modifies (confirmed against a live MySQL 9.7.1 server) — so the two
   * clauses are transposed relative to the pg original. See
   * docs/08-internationalization/index.md.
   */
  private async writeVersionLocaleLedger(
    tx: TxConnection,
    versionId: string,
    sourceLocale: string
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO byline_document_version_locales (document_version_id, locale)
      WITH loc AS (
        SELECT field_path, locale FROM byline_store_text     WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_numeric  WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_boolean  WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_datetime WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_file     WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_relation WHERE document_version_id = ${versionId} AND locale <> 'all'
        UNION SELECT field_path, locale FROM byline_store_json     WHERE document_version_id = ${versionId} AND locale <> 'all'
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
      SELECT ${versionId}, locale FROM covering
      UNION ALL
      SELECT ${versionId}, 'all' WHERE NOT EXISTS (SELECT 1 FROM loc)
    `)
  }

  /**
   * copyForwardStoreRows
   *
   * Carry forward one store table's rows for every locale except `'all'` and
   * the version's active write locale, from `prevVersionId` to `newVersionId`.
   * The MySQL counterpart of pg's `INSERT … SELECT gen_random_uuid(), … ON
   * CONFLICT (document_version_id, field_path, locale) DO NOTHING`: MySQL has
   * no per-row id generator usable from an `INSERT … SELECT`, and ids must be
   * app-generated UUIDv7 (never DB-generated, never `INSERT IGNORE` — see the
   * method doc on `createDocumentVersion`) — so this reads the candidate rows
   * with a typed `SELECT`, mints a fresh UUIDv7 per row in JS, and bulk-inserts
   * with `.onDuplicateKeyUpdate({ set: { id: sql\`id\` } })`, drizzle's own
   * documented no-op idiom for "do nothing on conflict" on MySQL. One generic
   * helper shared by all 7 call sites (pg keeps 7 near-identical raw-SQL
   * blocks because it doesn't need this per-row JS step; MySQL does, so
   * factoring it once here avoids seven copies of the same shape).
   *
   * `table` is threaded through as `AnyMySqlTable` and cast internally —
   * the 7 store tables share the same `(id, document_version_id, …, locale,
   * created_at, updated_at)` column shape (`baseStoreColumns` in the schema),
   * but Drizzle's query builder generics don't unify cleanly across a union
   * of distinct table types for `.from()` / `.insert()`, so the cast is
   * confined to this one private helper rather than leaking into the 7 call
   * sites, which stay fully typed.
   */
  private async copyForwardStoreRows(
    tx: TxConnection,
    table: AnyMySqlTable,
    prevVersionId: string,
    newVersionId: string,
    activeLocale: string
  ): Promise<void> {
    const t = table as unknown as {
      document_version_id: any
      locale: any
    }
    const rows = (await tx
      .select()
      .from(table as any)
      .where(
        and(eq(t.document_version_id, prevVersionId), notInArray(t.locale, ['all', activeLocale]))
      )) as unknown as Record<string, unknown>[]

    if (rows.length === 0) return

    const values = rows.map((row) => {
      const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row
      return { ...rest, id: uuidv7(), document_version_id: newVersionId }
    })

    await (tx.insert(table as any).values(values) as any).onDuplicateKeyUpdate({
      set: { id: sql`id` },
    })
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
   * Second caller into `writeDocumentPath` (the first is `createDocumentVersion`
   * step 2a) — see that method's docblock for the insert-then-catch-and-
   * conditionally-update targeting it does in place of pg's
   * `onConflictDoUpdate({ target })`.
   *
   * Source-locale enforcement and `ERR_PATH_CONFLICT` mapping live in the
   * lifecycle service that calls this; the command itself only performs the
   * upsert (and surfaces the raw `ER_DUP_ENTRY` for the service to translate
   * via `classifyError`).
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
   * completeness ledger. See docs/08-internationalization/index.md.
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
   * copyAllVersionStoreRows
   *
   * Copy every store row — all seven value-store tables (optionally excluding
   * one locale) plus the locale-agnostic `byline_store_meta` identity rows
   * (always copied wholesale, unfiltered — a block's identity is shared
   * across locales) — from one document version to another, verbatim. New
   * `id`s are minted per row (MySQL has no per-row `gen_random_uuid()`
   * usable from an `INSERT … SELECT`, and ids must be app-generated UUIDv7 —
   * see `copyForwardStoreRows` above); `created_at`/`updated_at` are left off
   * the inserted row so the column default (`CURRENT_TIMESTAMP(6)`) supplies
   * a fresh timestamp, matching pg's explicit `NOW(), NOW()`.
   *
   * The target version is assumed fresh (no existing rows), so — unlike
   * `copyForwardStoreRows`, which may collide with rows `createDocumentVersion`
   * already wrote in the same transaction — this performs a plain `INSERT`
   * with no conflict handling. A collision here would mean the caller reused
   * a non-fresh version id, which should fail loudly rather than being
   * silently absorbed. Used by `deleteDocumentLocale` to snapshot the current
   * version into the new one with the target locale's rows dropped.
   */
  private async copyAllVersionStoreRows(
    tx: TxConnection,
    fromVersionId: string,
    toVersionId: string,
    excludeLocale?: string
  ): Promise<void> {
    await this.copyVersionStoreRows(tx, textStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, numericStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, booleanStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, datetimeStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, jsonStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, relationStore, fromVersionId, toVersionId, excludeLocale)
    await this.copyVersionStoreRows(tx, fileStore, fromVersionId, toVersionId, excludeLocale)

    const metaRows = (await tx
      .select()
      .from(metaStore)
      .where(eq(metaStore.document_version_id, fromVersionId))) as unknown as Record<
      string,
      unknown
    >[]
    if (metaRows.length > 0) {
      const values = metaRows.map((row) => {
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row
        return { ...rest, id: uuidv7(), document_version_id: toVersionId }
      })
      await tx.insert(metaStore).values(values as any)
    }
  }

  /** One value-store table's share of `copyAllVersionStoreRows`. */
  private async copyVersionStoreRows(
    tx: TxConnection,
    table: AnyMySqlTable,
    fromVersionId: string,
    toVersionId: string,
    excludeLocale?: string
  ): Promise<void> {
    const t = table as unknown as { document_version_id: any; locale: any }
    const conditions = [eq(t.document_version_id, fromVersionId)]
    if (excludeLocale) conditions.push(ne(t.locale, excludeLocale))
    const rows = (await tx
      .select()
      .from(table as any)
      .where(and(...conditions))) as unknown as Record<string, unknown>[]

    if (rows.length === 0) return

    const values = rows.map((row) => {
      const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row
      return { ...rest, id: uuidv7(), document_version_id: toVersionId }
    })

    await tx.insert(table as any).values(values)
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
   * Defensively returns `null` when the document has no current version (the
   * service validates existence first, so this is a guard).
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
   * Returns the number of rows updated. MySQL has no `RETURNING` and drizzle's
   * mysql2 `update()` resolves to a `[ResultSetHeader, FieldPacket[]]` tuple
   * rather than pg's driver result object — `affectedRows` lives on the first
   * element (confirmed live against the test database), not `.rowCount`. See
   * `affectedRowCount()` in `storage-utils.ts`, shared by every guarded write
   * in this adapter (this method, `softDeleteDocument` below, and the admin
   * repositories) for that cast.
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
    return affectedRowCount(result)
  }

  /**
   * softDeleteDocument
   *
   * Tombstone every path and version row for a document with one operation
   * timestamp. Live views and path resolution filter these rows without
   * physically removing retained content or path values.
   *
   * Returns the number of version rows marked as deleted.
   */
  async softDeleteDocument(params: { document_id: string }): Promise<number> {
    const deletedAt = new Date()
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

      await tx
        .update(documentPaths)
        .set({
          deleted_at: deletedAt,
          updated_at: deletedAt,
        })
        .where(eq(documentPaths.document_id, params.document_id))

      const result = await tx
        .update(documentVersions)
        .set({
          is_deleted: true,
          updated_at: deletedAt,
        })
        .where(eq(documentVersions.document_id, params.document_id))
      return affectedRowCount(result)
    })
  }

  /**
   * Restore every path and version tombstone for a fully soft-deleted document.
   *
   * Takes the same collection then document locks as soft delete. A missing,
   * versionless, already-live, or legacy partially-live document is a no-op.
   * Path uniqueness is revalidated by the live unique constraint; any conflict
   * aborts both updates. Tree placement and search/cache projections are not
   * reconstructed by this storage primitive.
   */
  async restoreSoftDeletedDocument(params: { document_id: string }): Promise<number> {
    const restoredAt = new Date()
    return this.db.transaction(async (tx) => {
      const collectionId = await this.lockDocumentCollection(tx, params.document_id)
      if (collectionId == null) return 0

      const [document] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, params.document_id))
        .for('update')
      if (document == null) return 0

      const versionLiveness = await this.readDocumentVersionLiveness(tx, params.document_id)
      if (versionLiveness.total === 0 || versionLiveness.live > 0) return 0

      await tx
        .update(documentPaths)
        .set({
          deleted_at: null,
          updated_at: restoredAt,
        })
        .where(eq(documentPaths.document_id, params.document_id))

      const result = await tx
        .update(documentVersions)
        .set({
          is_deleted: false,
          updated_at: restoredAt,
        })
        .where(eq(documentVersions.document_id, params.document_id))
      return affectedRowCount(result)
    })
  }

  private async readDocumentVersionLiveness(
    tx: TxConnection,
    documentId: string
  ): Promise<{ total: number; live: number }> {
    // Match the live views: only explicit `false` is live; legacy `NULL` is not.
    return tx
      .select({
        total: sql<number>`CAST(COUNT(*) AS SIGNED)`,
        live: sql<number>`CAST(COUNT(CASE WHEN ${documentVersions.is_deleted} = false THEN 1 END) AS SIGNED)`,
      })
      .from(documentVersions)
      .where(eq(documentVersions.document_id, documentId))
      .then(getFirstOrThrow('Failed to read document version liveness'))
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

  /**
   * Serialize structural changes per collection and verify the collection
   * exists. `FOR UPDATE` — no `FOR UPDATE OF` qualifier needed since this
   * query selects from a single table (confirmed against a live MySQL 9.7.1
   * server; MySQL 8.0.1+ supports `FOR UPDATE OF tbl_name` for the
   * multi-table case used below in `lockDocumentCollection`).
   */
  private async lockTreeCollection(tx: TxConnection, collectionId: string): Promise<void> {
    const locked = await tx.execute(sql`
      SELECT id FROM byline_collections
      WHERE id = ${collectionId}
      FOR UPDATE
    `)
    const rows = (locked as unknown as [Array<{ id: string }>, unknown])[0]
    if (rows.length === 0) {
      throw ERR_NOT_FOUND({ message: 'collection not found', details: { collectionId } })
    }
  }

  /**
   * Resolve a document's collection while locking only the collection row.
   * `FOR UPDATE OF c` — confirmed live against a MySQL 9.7.1 server (MySQL
   * 8.0.1+ supports the per-table lock qualifier; `::uuid` casts dropped).
   */
  private async lockDocumentCollection(
    tx: TxConnection,
    documentId: string
  ): Promise<string | null> {
    const locked = await tx.execute(sql`
      SELECT c.id AS collection_id
      FROM byline_collections c
      JOIN byline_documents d ON d.collection_id = c.id
      WHERE d.id = ${documentId}
      FOR UPDATE OF c
    `)
    const rows = (locked as unknown as [Array<{ collection_id: string }>, unknown])[0]
    return rows[0]?.collection_id ?? null
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
        WHERE d.id = ${documentId}
          AND d.collection_id = ${collectionId}
        UNION ALL
        SELECT r.child_document_id, s.depth + 1
        FROM byline_document_relationships r
        JOIN subtree s ON r.parent_document_id = s.document_id
        JOIN byline_documents d ON d.id = r.child_document_id
        WHERE d.collection_id = ${collectionId}
          AND s.depth < ${TREE_MAX_DEPTH}
      )
      SELECT document_id FROM subtree ORDER BY depth
    `)
    const rows = (result as unknown as [Array<{ document_id: string }>, unknown])[0]
    return rows.map((row) => row.document_id)
  }

  /**
   * placeTreeNode — see {@link IDocumentCommands.placeTreeNode}.
   *
   * Single transaction: same-collection guard → cycle guard → resolve the
   * target sibling group's neighbour keys → mint a fractional key → upsert the
   * edge row. Unversioned; touches only `byline_document_relationships`.
   *
   * The edge upsert uses a plain `.onDuplicateKeyUpdate()` — unlike
   * `writeDocumentPath`, `byline_document_relationships` carries exactly one
   * unique constraint (`uq_document_relationships_child`, on
   * `child_document_id`), so MySQL's lack of per-constraint targeting is not
   * an issue here: any duplicate-key collision on this table can only be that
   * one index, so there is no ambiguity to guard against.
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
            SELECT ${parentDocumentId} AS node_id, 0 AS depth
            UNION ALL
            SELECT r.parent_document_id, c.depth + 1
            FROM byline_document_relationships r
            JOIN chain c ON r.child_document_id = c.node_id
            WHERE r.parent_document_id IS NOT NULL AND c.depth < ${TREE_MAX_DEPTH}
          )
          SELECT 1 FROM chain WHERE node_id = ${documentId} LIMIT 1
        `)
        const cycleRows = (cycle as unknown as [Array<{ 1: number }>, unknown])[0]
        if (cycleRows.length > 0) {
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
        .onDuplicateKeyUpdate({
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
