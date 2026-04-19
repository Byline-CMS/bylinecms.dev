/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Relationship population service.
 *
 * `populateDocuments` walks a set of reconstructed documents, finds every
 * relation leaf that matches a caller-supplied populate spec, batches
 * fetches against each target collection (one DB round-trip per depth
 * level per target collection), and replaces each leaf in place with the
 * populated document. Missing targets become a `{ _resolved: false }`
 * stub; already-visited targets become a `{ _cycle: true }` stub.
 *
 * Consumed by both `@byline/client` (external read API with `populate`
 * and `depth` options) and the admin webapp's API-preview server fn.
 *
 * A request-scoped `ReadContext` is threaded through the walk. Its
 * `visited` set and `readCount` budget guard against recursive reads —
 * particularly the A→B→A failure mode that appears when future
 * `afterRead` hooks invoke their own reads from within populated
 * documents. The guard is in place from day one so that the hook work
 * in Phase 4+ cannot reintroduce the problem.
 *
 * See docs/analysis/RELATIONSHIPS-ANALYSIS.md for the full design rationale.
 *
 * ---------------------------------------------------------------------
 * DSL summary
 * ---------------------------------------------------------------------
 *
 * The populate DSL has two independent axes:
 *
 *   1. **Scope** — which relations in the *source* document to walk.
 *   2. **Projection** — which fields of each *target* document to load.
 *
 * The top-level `populate` value selects scope + (optionally) a uniform
 * projection across the whole tree:
 *
 *   - `populate: true`                  → walk every relation leaf,
 *                                         default projection at every
 *                                         depth. See below for exactly
 *                                         what the default projection
 *                                         returns.
 *   - `populate: '*'`                   → walk every relation leaf, full
 *                                         document projection at every
 *                                         depth. Symmetric with the
 *                                         sub-spec shorthand and intended
 *                                         for tools like the admin API
 *                                         preview where the whole tree
 *                                         should be visible.
 *   - `populate: { name: … }`           → walk only the named relations.
 *   - `populate: undefined`             → skip populate entirely (no-op).
 *
 * Default projection — exactly what comes back for `true` (and for any
 * sub-spec whose `select` is omitted):
 *
 *   - **Document row metadata, always present** (lives on the
 *     `document_versions` row, not in the `store_*` tables, so it is
 *     returned regardless of the `fields` projection):
 *       `document_version_id`, `document_id`, `collection_id`, `path`,
 *       `status`, `created_at`, `updated_at`.
 *   - **The `useAsTitle` field** (schema-declared identity field;
 *     falls back to the first declared text field when `useAsTitle`
 *     is not set on the `CollectionDefinition`). This is the one
 *     entry added to the `fields` object.
 *
 * In effect "default projection" is "enough to identify and label the
 * target" — document metadata for wiring, plus one user-defined field
 * (typically `title`) for a human-readable label. Callers wanting more
 * use `'*'` (full doc) or `{ select: [...] }` (explicit fields).
 *
 * Each matched leaf carries a `PopulateFieldSpec` that selects projection:
 *
 *   - `true`                            → default projection: the target's
 *                                         identity field (`useAsTitle`,
 *                                         falling back to the first text
 *                                         field). Document metadata
 *                                         (`document_id`, `collection_id`,
 *                                         `path`, `status`, timestamps) is
 *                                         always included for free — it
 *                                         lives on the row, not in the
 *                                         store_* tables.
 *   - `'*'`                             → full document: every field of
 *                                         the target is loaded.
 *   - `{ select: [...] }`               → explicit field list, merged with
 *                                         the identity field so downstream
 *                                         UI always has a label to render.
 *   - `{ populate: {...} }`             → nested populate for the next
 *                                         depth level. Combinable with
 *                                         `select`.
 *
 * Examples:
 *
 *   populate: true
 *     → every relation, default projection at every depth level.
 *
 *   populate: '*'
 *     → every relation, full projection at every depth level
 *       (use for API previews / debug views that want the whole tree).
 *
 *   populate: { heroImage: true }
 *     → only heroImage, default projection. If heroImage's own
 *       relations exist, they populate at the next depth with `true`.
 *
 *   populate: { heroImage: '*' }
 *     → only heroImage, full document. If heroImage's own relations
 *       exist, they populate at the next depth with `'*'` (consistent
 *       with how `true` propagates).
 *
 *   populate: { author: { select: ['name'] } }
 *     → only author; fetch `name` + identity field.
 *
 *   populate: { author: { select: ['name'], populate: { employer: '*' } } }
 *     → author with `name` at depth 1; employer fully populated at depth 2.
 *
 * Notes:
 *
 *   - `'*'` belongs on the sub-spec (or as the whole top-level spec),
 *     not inside `select`. `select` is always an explicit field list.
 *   - Projection defaults are transitive at every depth: `true` propagates
 *     `true` into nested levels; `'*'` propagates `'*'`. Explicit
 *     `{ populate: {...} }` maps take precedence when declared.
 *   - Multiple leaves pointing at the same target document are batched
 *     into a single fetch; their projection specs are merged (any `'*'`
 *     wins; otherwise selects union together, identity field is always
 *     added).
 */

import { ERR_READ_BUDGET_EXCEEDED } from '../lib/errors.js'
import { applyAfterRead } from './document-read.js'
import type {
  CollectionDefinition,
  FieldSet,
  IDbAdapter,
  ReadContext,
  ReadMode,
  RelatedDocumentValue,
  RelationField,
} from '../@types/index.js'

// Re-export for back-compat with consumers that import ReadContext from
// @byline/core/services (the type itself now lives in `@types/db-types.ts`
// to keep it reachable from collection-hook typings).
export type { ReadContext } from '../@types/index.js'

// ---------------------------------------------------------------------------
// ReadContext — recursion guard
// ---------------------------------------------------------------------------

const DEFAULT_MAX_READS = 500
const DEFAULT_MAX_DEPTH = 8

/** Build a fresh ReadContext. */
export function createReadContext(overrides?: Partial<ReadContext>): ReadContext {
  return {
    visited: overrides?.visited ?? new Set(),
    afterReadFired: overrides?.afterReadFired ?? new Set(),
    readCount: overrides?.readCount ?? 0,
    maxReads: overrides?.maxReads ?? DEFAULT_MAX_READS,
    maxDepth: overrides?.maxDepth ?? DEFAULT_MAX_DEPTH,
  }
}

// ---------------------------------------------------------------------------
// Populate DSL
// ---------------------------------------------------------------------------

/**
 * Per-field populate options. `select` names the target's fields to
 * load (merged with the target's identity field so UI always has a
 * label to render); `populate` nests for deeper relations.
 *
 * Use the `'*'` sub-spec shorthand instead when you want the full
 * target document — `select` is strictly for explicit field lists.
 */
export interface PopulateFieldOptions {
  select?: string[]
  populate?: PopulateMap
}

/**
 * Per-relation projection selector.
 *
 * - `true` → default projection (identity field only; metadata is free).
 * - `'*'`  → full document (every field loaded).
 * - `{ select: [...] }` or `{ populate: {...} }` → explicit options.
 *
 * See the DSL summary at the top of this file for the full semantics.
 */
export type PopulateFieldSpec = true | '*' | PopulateFieldOptions

/**
 * Top-level populate spec. Keys are relation field names (matched
 * anywhere in the source document's field tree, including inside
 * `group` / `array` / `blocks` structures).
 */
export type PopulateMap = Record<string, PopulateFieldSpec>

/**
 * Top-level populate spec. Three shapes:
 *
 *   - `true`        → populate every relation leaf encountered, with
 *                     default projection (identity only) at every level.
 *   - `'*'`         → populate every relation leaf, with full projection
 *                     at every level. Symmetric with the sub-spec `'*'`
 *                     shorthand.
 *   - `PopulateMap` → populate only the named relations, with per-field
 *                     projection selectors.
 */
export type PopulateSpec = true | '*' | PopulateMap

// ---------------------------------------------------------------------------
// PopulateOptions — the public entry
// ---------------------------------------------------------------------------

export interface PopulateOptions {
  db: IDbAdapter
  /** Every collection definition in the app — needed to resolve target fields. */
  collections: CollectionDefinition[]
  /** The source collection id for `documents`. */
  collectionId: string
  /**
   * Documents to populate, as returned from a read operation. Must carry
   * `document_id` and `fields`. Mutated in place — every relation leaf
   * in `fields` that is walked becomes an envelope: the original
   * `{ target_document_id, target_collection_id, relationship_type?,
   * cascade_delete? }` refs are preserved, and discriminator fields
   * (`_resolved`, `_cycle`) plus an optional `document` property are
   * layered on top. See the `PopulatedRelationValue` /
   * `UnresolvedRelationValue` / `CycleRelationValue` interfaces below.
   */
  documents: Array<Record<string, any>>
  /** What to populate. Omit to no-op. */
  populate?: PopulateSpec
  /**
   * Max walk depth. Defaults to 1 when `populate` is present, 0 otherwise.
   * Clamped to `readContext.maxDepth`.
   */
  depth?: number
  /** Locale forwarded to the batch fetch. */
  locale?: string
  /**
   * Read mode forwarded to `getDocumentsByDocumentIds`. Selects whether
   * populated targets are resolved from `current_documents` (default,
   * `'any'`) or `current_published_documents` (`'published'`). Public
   * consumers of `@byline/client` typically want `'published'` so a
   * populated target that currently has a newer draft still resolves to
   * its last published version rather than leaking a draft.
   */
  readMode?: ReadMode
  /**
   * Request-scoped recursion guard. Omit to create a fresh context for
   * this top-level call. Threaded through by future read-side hooks to
   * prevent A→B→A infinite loops.
   */
  readContext?: ReadContext
}

// ---------------------------------------------------------------------------
// Relation envelope — the shared shape across all four relation states
// ---------------------------------------------------------------------------
//
// Every relation leaf — whether an unpopulated ref, a successfully populated
// link, a deleted target, or a cycle stop — shares the `RelatedDocumentValue`
// base (`target_document_id`, `target_collection_id`, and optional link
// metadata `relationship_type` / `cascade_delete`). The `_resolved` /
// `_cycle` / `document` properties discriminate the four states:
//
//   Unpopulated (no populate pass, or this leaf not in scope)
//     { target_document_id, target_collection_id, relationship_type?, cascade_delete? }
//
//   Populated (target fetched and attached)
//     { ..., _resolved: true, document: { ...fetched target doc } }
//
//   Unresolved (target not found — usually deleted)
//     { ..., _resolved: false }
//
//   Cycle (target already materialised earlier in this request)
//     { ..., _resolved: true, _cycle: true }
//
// Narrowing at the call site is straightforward:
//
//   if (v._cycle)                             → cycle
//   else if (v._resolved === false)           → unresolved (deleted)
//   else if (v._resolved === true && v.document) → populated — read v.document
//   else                                       → unpopulated raw ref

/** Marker placed in a relation leaf when the target was already materialised earlier in this request. */
export interface CycleRelationValue extends RelatedDocumentValue {
  _resolved: true
  _cycle: true
}

/** Marker placed in a relation leaf when the target was not found (deleted). */
export interface UnresolvedRelationValue extends RelatedDocumentValue {
  _resolved: false
}

/**
 * Envelope placed in a relation leaf when populate successfully fetched
 * the target document. The `document` field carries the raw storage-shape
 * doc (`@byline/client` then reshapes it to `ClientDocument` during
 * response shaping).
 */
export interface PopulatedRelationValue extends RelatedDocumentValue {
  _resolved: true
  document: Record<string, any>
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Populate relation leaves in `opts.documents` in place, one DB
 * round-trip per depth level per target collection.
 */
export async function populateDocuments(opts: PopulateOptions): Promise<void> {
  const ctx = opts.readContext ?? createReadContext()
  const populate = opts.populate
  const requestedDepth = opts.depth ?? (populate !== undefined ? 1 : 0)
  const maxDepth = Math.max(0, Math.min(requestedDepth, ctx.maxDepth))

  // Mark the input documents as visited regardless of whether we populate —
  // a future read-side hook that triggers further reads will then skip
  // re-materialising documents it has already seen.
  for (const doc of opts.documents) {
    const id = doc?.document_id
    if (typeof id === 'string') {
      ctx.visited.add(visitedKey(opts.collectionId, id))
    }
  }

  if (populate === undefined || maxDepth === 0 || opts.documents.length === 0) {
    return
  }

  // Per-call cache: collection lookup key → resolved CollectionDefinition.
  // Populated on first hit via synthetic match, path match, or a one-time
  // `db.queries.collections.getCollectionById` fallback. Negative results
  // are cached too (null) so we never double-query a missing target.
  const defCache: CollectionDefCache = new Map()

  const sourceDef = await resolveCollectionDef(
    opts.db,
    opts.collections,
    opts.collectionId,
    defCache
  )
  if (!sourceDef) {
    // Cannot walk without field definitions; leave documents untouched.
    return
  }

  // The "current level" is a list of {containing document, its field defs,
  // the populate spec to apply when walking it}. Level 0 is the input set.
  interface LevelEntry {
    doc: Record<string, any>
    fieldDefs: FieldSet
    populate: PopulateSpec
  }

  let current: LevelEntry[] = opts.documents.map((doc) => ({
    doc,
    fieldDefs: sourceDef.fields,
    populate,
  }))

  for (let level = 0; level < maxDepth; level++) {
    const allLeaves: RelationLeafRef[] = []
    for (const entry of current) {
      if (entry.doc?.fields && typeof entry.doc.fields === 'object') {
        collectRelationLeaves(
          entry.doc.fields as Record<string, any>,
          entry.fieldDefs,
          entry.populate,
          allLeaves
        )
      }
    }
    if (allLeaves.length === 0) break

    // Group by target collection so we batch one query per target.
    const byTarget = new Map<string, RelationLeafRef[]>()
    for (const leaf of allLeaves) {
      const tid = leaf.value.target_collection_id
      const arr = byTarget.get(tid)
      if (arr) arr.push(leaf)
      else byTarget.set(tid, [leaf])
    }

    const nextLevel: LevelEntry[] = []
    const queuedForNext = new Set<string>()

    for (const [targetCollectionId, leaves] of byTarget) {
      const targetDef = await resolveCollectionDef(
        opts.db,
        opts.collections,
        targetCollectionId,
        defCache
      )
      const selectList = buildBatchSelect(leaves, targetDef)

      // Only fetch IDs we haven't materialised earlier in this request.
      const idsToFetch = Array.from(
        new Set(
          leaves
            .filter(
              (l) => !ctx.visited.has(visitedKey(targetCollectionId, l.value.target_document_id))
            )
            .map((l) => l.value.target_document_id)
        )
      )

      let fetched: any[] = []
      if (idsToFetch.length > 0) {
        fetched = await opts.db.queries.documents.getDocumentsByDocumentIds({
          collection_id: targetCollectionId,
          document_ids: idsToFetch,
          locale: opts.locale,
          fields: selectList,
          readMode: opts.readMode,
        })
      }

      const byId = new Map<string, any>()
      for (const d of fetched) {
        if (typeof d?.document_id === 'string') byId.set(d.document_id, d)
      }

      // First pass: replace leaves with envelopes (reading visited state
      // before we update it). Each envelope preserves the original link
      // metadata (`target_document_id`, `target_collection_id`, and any
      // `relationship_type` / `cascade_delete`) so consumers can
      // round-trip or inspect the relationship regardless of outcome.
      for (const leaf of leaves) {
        const { target_document_id, target_collection_id } = leaf.value
        const key = visitedKey(target_collection_id, target_document_id)

        if (ctx.visited.has(key)) {
          leaf.parent[leaf.key as any] = {
            ...leaf.value,
            _resolved: true,
            _cycle: true,
          } satisfies CycleRelationValue
          continue
        }

        const fetchedDoc = byId.get(target_document_id)
        if (fetchedDoc === undefined) {
          leaf.parent[leaf.key as any] = {
            ...leaf.value,
            _resolved: false,
          } satisfies UnresolvedRelationValue
          continue
        }

        leaf.parent[leaf.key as any] = {
          ...leaf.value,
          _resolved: true,
          document: fetchedDoc,
        } satisfies PopulatedRelationValue
      }

      // Second pass: mark freshly fetched docs visited, update readCount,
      // fire `afterRead`, enforce the budget, and queue them for the next
      // level (dedup by id).
      //
      // `afterRead` fires here rather than after the full walk so the hook
      // can mutate targets before their envelopes land in the source tree.
      // A target's own direct relations may still be raw refs at this point
      // (they populate on the next depth level); a hook that wants to
      // observe populated grandchildren should run at the outer / source
      // level where populate has fully returned.
      for (const d of fetched) {
        const id = d.document_id as string
        const key = visitedKey(targetCollectionId, id)
        if (ctx.visited.has(key)) continue
        ctx.visited.add(key)
        ctx.readCount += 1
        if (ctx.readCount > ctx.maxReads) {
          throw ERR_READ_BUDGET_EXCEEDED({
            message: `populate exceeded read budget (maxReads=${ctx.maxReads})`,
            details: {
              readCount: ctx.readCount,
              maxReads: ctx.maxReads,
              targetCollectionId,
              targetDocumentId: id,
            },
          })
        }

        if (targetDef) {
          await applyAfterRead({ doc: d, definition: targetDef, readContext: ctx })
        }

        if (!targetDef || queuedForNext.has(key)) continue

        const childPopulate = reduceChildPopulate(leaves, id)
        if (childPopulate === undefined) continue

        queuedForNext.add(key)
        nextLevel.push({
          doc: d,
          fieldDefs: targetDef.fields,
          populate: childPopulate,
        })
      }
    }

    current = nextLevel
    if (current.length === 0) break
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function visitedKey(collectionId: string, documentId: string): string {
  return `${collectionId}:${documentId}`
}

/** Per-call cache of collection-id → definition (or null for missing). */
type CollectionDefCache = Map<string, CollectionDefinition | null>

/**
 * Resolve a collection reference (DB UUID *or* path) to its
 * `CollectionDefinition`. Tries in order:
 *
 *   1. Synthetic `.id` match on the collections array — supports unit
 *      tests that attach a synthetic id, and is a cheap win when the
 *      caller has pre-decorated collections with DB UUIDs.
 *   2. Direct `.path` match — the public API of CollectionDefinition.
 *   3. DB fallback via `getCollectionById(id)` — resolves a real DB
 *      UUID to its path, then matches on the path. This is the
 *      production path for the admin server fn and `@byline/client`,
 *      which both pass DB UUIDs as `collectionId` / `target_collection_id`.
 *
 * Results (including misses) are cached in `cache` for the duration of
 * the current populate call.
 */
async function resolveCollectionDef(
  db: IDbAdapter,
  collections: CollectionDefinition[],
  id: string,
  cache: CollectionDefCache
): Promise<CollectionDefinition | undefined> {
  if (cache.has(id)) {
    return cache.get(id) ?? undefined
  }

  // 1. Synthetic `.id` (tests, pre-decorated arrays)
  let def: CollectionDefinition | undefined =
    collections.find((c) => (c as any).id === id) ??
    // 2. Path match
    collections.find((c) => c.path === id)

  // 3. DB fallback
  if (!def) {
    try {
      const row = await db.queries.collections.getCollectionById(id)
      if (row && typeof row.path === 'string') {
        def = collections.find((c) => c.path === row.path)
      }
    } catch {
      // Missing target collection is handled by the caller via the
      // unresolved-stub path — swallow lookup errors here.
    }
  }

  cache.set(id, def ?? null)
  return def
}

/**
 * A single relation leaf pending populate. `parent[key]` currently holds a
 * `RelatedDocumentValue`; after processing it holds either a populated
 * document or a stub (cycle / unresolved).
 */
interface RelationLeafRef {
  parent: Record<string, any>
  key: string
  field: RelationField
  value: RelatedDocumentValue
  /**
   * Per-leaf populate sub-spec resolved from the PopulateMap.
   *
   * - `true`  → default projection (identity field only).
   * - `'*'`   → full document (all fields).
   * - object → explicit `select` and/or nested `populate`.
   */
  sub: PopulateFieldSpec
}

/**
 * Walk `fields` against `fieldDefs` and collect every relation leaf whose
 * name matches `populate`. Recurses through `group` / `array` / `blocks`
 * using the same populate spec (structure field names do not scope the
 * match — if `populate: { author: true }` is given, every `author`
 * relation found in the tree matches).
 */
function collectRelationLeaves(
  fields: Record<string, any>,
  fieldDefs: FieldSet,
  populate: PopulateSpec,
  acc: RelationLeafRef[]
): void {
  for (const def of fieldDefs) {
    const rawValue = fields[def.name]
    if (rawValue == null) continue

    if (def.type === 'relation') {
      const sub = matchesPopulate(def.name, populate)
      if (sub === undefined) continue
      if (!isRelatedDocumentValue(rawValue)) continue
      // Skip leaves that have already been replaced (e.g. via shared-ref
      // duplication at the previous level); only raw RelatedDocumentValues
      // are candidates for population.
      if ('_resolved' in (rawValue as Record<string, any>)) continue
      acc.push({
        parent: fields,
        key: def.name,
        field: def,
        value: rawValue,
        sub,
      })
      continue
    }

    if (def.type === 'group') {
      if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        collectRelationLeaves(rawValue as Record<string, any>, def.fields, populate, acc)
      }
      continue
    }

    if (def.type === 'array') {
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            collectRelationLeaves(item as Record<string, any>, def.fields, populate, acc)
          }
        }
      }
      continue
    }

    if (def.type === 'blocks') {
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            // Reconstructed block items carry `_type` set to the variant's `blockType`.
            const blockType = (item as Record<string, any>)._type
            if (typeof blockType !== 'string') continue
            const block = def.blocks.find((b) => b.blockType === blockType)
            if (!block) continue
            collectRelationLeaves(item as Record<string, any>, block.fields, populate, acc)
          }
        }
      }
    }
  }
}

function matchesPopulate(fieldName: string, populate: PopulateSpec): PopulateFieldSpec | undefined {
  if (populate === true) return true
  if (populate === '*') return '*'
  const spec = populate[fieldName]
  return spec
}

function isRelatedDocumentValue(v: unknown): v is RelatedDocumentValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as any).target_document_id === 'string' &&
    typeof (v as any).target_collection_id === 'string'
  )
}

/**
 * Build the `fields` array for a batch fetch against a single target
 * collection.
 *
 *   - Any leaf with `sub === '*'` → `undefined` (fetch all fields).
 *   - Otherwise → union of explicit `select` lists from each leaf,
 *     merged with the target's identity field (`useAsTitle`, falling
 *     back to the first text field). `sub === true` contributes no
 *     selects, so a batch of only-`true` leaves collapses to the
 *     identity field alone — the default projection.
 *
 * Document metadata (`document_id`, `collection_id`, `path`, `status`,
 * timestamps) lives on the row itself and is always returned — it does
 * not need to appear in the `fields` list.
 */
function buildBatchSelect(
  leaves: RelationLeafRef[],
  targetDef: CollectionDefinition | undefined
): string[] | undefined {
  const union = new Set<string>()
  for (const leaf of leaves) {
    if (leaf.sub === '*') return undefined
    if (leaf.sub === true) continue
    const select = leaf.sub.select
    if (select) {
      for (const name of select) union.add(name)
    }
  }
  if (targetDef) {
    const identity = resolveIdentityField(targetDef)
    if (identity) union.add(identity)
  }
  return Array.from(union)
}

/**
 * The field that represents a target document's identity for populate's
 * default projection. Prefers `useAsTitle` (server-safe schema-level
 * config), falling back to the first declared text field.
 */
function resolveIdentityField(def: CollectionDefinition): string | undefined {
  if (def.useAsTitle) return def.useAsTitle
  const firstText = def.fields.find((f) => f.type === 'text')
  return firstText?.name
}

/**
 * Merge the per-leaf sub-populate specs for all leaves pointing at a
 * single (now-populated) target document into a single PopulateSpec for
 * the next level's walk of that document. Returns `undefined` if the
 * leaves don't request any nested population (in which case the populated
 * document's own relations stay as raw refs).
 *
 * Sub-spec semantics at the next level:
 *   - `'*'`  → propagate `'*'` (scope=all, full projection, recursive).
 *              `'*'` wins over `true` when both appear in the same batch
 *              so the caller's "full document" intent is preserved.
 *   - `true` → recurse into every relation of the target (scope=all,
 *              default projection).
 *   - object → forward any nested `populate` map; ignore `select`.
 */
function reduceChildPopulate(
  leaves: RelationLeafRef[],
  targetDocumentId: string
): PopulateSpec | undefined {
  let anyStar = false
  let anyTrue = false
  const merged: PopulateMap = {}
  let hasMerged = false
  for (const l of leaves) {
    if (l.value.target_document_id !== targetDocumentId) continue
    if (l.sub === '*') {
      anyStar = true
      break
    }
    if (l.sub === true) {
      anyTrue = true
      continue
    }
    if (l.sub.populate !== undefined) {
      for (const [k, v] of Object.entries(l.sub.populate)) {
        merged[k] = v
        hasMerged = true
      }
    }
  }
  if (anyStar) return '*'
  if (anyTrue) return true
  if (hasMerged) return merged
  return undefined
}

// ---------------------------------------------------------------------------
// Internal re-exports for tests
// ---------------------------------------------------------------------------

export const __internal = {
  collectRelationLeaves,
  matchesPopulate,
  buildBatchSelect,
  reduceChildPopulate,
  visitedKey,
}
