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
 * See RELATIONSHIPS.md for the full design rationale.
 */

import { ERR_READ_BUDGET_EXCEEDED } from '../lib/errors.js'
import type {
  CollectionDefinition,
  FieldSet,
  IDbAdapter,
  RelatedDocumentValue,
  RelationField,
} from '../@types/index.js'

// ---------------------------------------------------------------------------
// ReadContext — recursion guard
// ---------------------------------------------------------------------------

/**
 * Request-scoped context shared across all reads and populate walks in
 * one logical request. Future read-side hooks (`afterRead` etc.) will
 * thread the same context to prevent A→B→A cycles through hook-triggered
 * reads that populate's own visited set cannot otherwise see.
 */
export interface ReadContext {
  /**
   * Composite keys (`${target_collection_id}:${document_id}`) for every
   * document materialised during this request. Survives across nested
   * populate levels and, once wired, across hook-triggered reads.
   */
  visited: Set<string>
  /** Monotonic count of document materialisations; compared against `maxReads`. */
  readCount: number
  /** Hard ceiling on materialisations per request. Default 500. */
  maxReads: number
  /** Hard ceiling on populate depth per request. Default 8. */
  maxDepth: number
}

const DEFAULT_MAX_READS = 500
const DEFAULT_MAX_DEPTH = 8

/** Build a fresh ReadContext. */
export function createReadContext(overrides?: Partial<ReadContext>): ReadContext {
  return {
    visited: overrides?.visited ?? new Set(),
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
 * load; `populate` nests for deeper relations.
 */
export interface PopulateFieldOptions {
  select?: string[]
  populate?: PopulateMap
}

/**
 * Top-level populate spec. Keys are relation field names (matched
 * anywhere in the source document's field tree, including inside
 * `group` / `array` / `blocks` structures).
 */
export type PopulateMap = Record<string, true | PopulateFieldOptions>

/**
 * `true` → populate every relation leaf encountered, recursively.
 * `PopulateMap` → populate only the named relations, with optional
 * per-field `select` / nested `populate`.
 */
export type PopulateSpec = true | PopulateMap

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
   * `document_id` and `fields`. Mutated in place — relation leaves in
   * `fields` are replaced with populated documents or cycle / unresolved
   * stubs.
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
   * Request-scoped recursion guard. Omit to create a fresh context for
   * this top-level call. Threaded through by future read-side hooks to
   * prevent A→B→A infinite loops.
   */
  readContext?: ReadContext
}

// ---------------------------------------------------------------------------
// Markers — replacement shapes for leaves we can't populate
// ---------------------------------------------------------------------------

/** Marker placed in a relation leaf when the target was not found (deleted). */
export interface UnresolvedRelationValue extends RelatedDocumentValue {
  _resolved: false
}

/** Marker placed in a relation leaf when the target was already materialised earlier in this request. */
export interface CycleRelationValue extends RelatedDocumentValue {
  _resolved: true
  _cycle: true
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
        })
      }

      const byId = new Map<string, any>()
      for (const d of fetched) {
        if (typeof d?.document_id === 'string') byId.set(d.document_id, d)
      }

      // First pass: replace leaves (reading visited state before we update it).
      for (const leaf of leaves) {
        const { target_document_id, target_collection_id } = leaf.value
        const key = visitedKey(target_collection_id, target_document_id)

        if (ctx.visited.has(key)) {
          leaf.parent[leaf.key as any] = {
            target_document_id,
            target_collection_id,
            _resolved: true,
            _cycle: true,
          } satisfies CycleRelationValue
          continue
        }

        const fetchedDoc = byId.get(target_document_id)
        if (fetchedDoc === undefined) {
          leaf.parent[leaf.key as any] = {
            target_document_id,
            target_collection_id,
            _resolved: false,
          } satisfies UnresolvedRelationValue
          continue
        }

        leaf.parent[leaf.key as any] = fetchedDoc
      }

      // Second pass: mark freshly fetched docs visited, update readCount,
      // enforce the budget, and queue them for the next level (dedup by id).
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
   * Per-leaf populate sub-spec resolved from the PopulateMap. `true` means
   * "populate this leaf with default select"; an object carries optional
   * nested `select` / `populate`.
   */
  sub: true | PopulateFieldOptions
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

function matchesPopulate(
  fieldName: string,
  populate: PopulateSpec
): true | PopulateFieldOptions | undefined {
  if (populate === true) return true
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
 * collection. Unions the explicit `select` lists from all leaves pointing
 * at this collection; returns `undefined` (fetch all fields) if any leaf
 * is `populate: true` or omits `select`. Always includes the collection's
 * first text field so that downstream UI has a default label to render.
 */
function buildBatchSelect(
  leaves: RelationLeafRef[],
  targetDef: CollectionDefinition | undefined
): string[] | undefined {
  let wantAll = false
  const union = new Set<string>()
  for (const leaf of leaves) {
    if (leaf.sub === true) {
      wantAll = true
      break
    }
    const select = leaf.sub.select
    if (!select || select.length === 0) {
      wantAll = true
      break
    }
    for (const name of select) union.add(name)
  }
  if (wantAll) return undefined
  if (targetDef) {
    const firstText = targetDef.fields.find((f) => f.type === 'text')
    if (firstText) union.add(firstText.name)
  }
  return Array.from(union)
}

/**
 * Merge the per-leaf sub-populate specs for all leaves pointing at a
 * single (now-populated) target document into a single PopulateSpec for
 * the next level's walk of that document. Returns `undefined` if the
 * leaves don't request any nested population (in which case the populated
 * document's own relations stay as raw refs).
 */
function reduceChildPopulate(
  leaves: RelationLeafRef[],
  targetDocumentId: string
): PopulateSpec | undefined {
  let anyTrue = false
  const merged: PopulateMap = {}
  let hasMerged = false
  for (const l of leaves) {
    if (l.value.target_document_id !== targetDocumentId) continue
    if (l.sub === true) {
      anyTrue = true
      break
    }
    if (l.sub.populate !== undefined) {
      for (const [k, v] of Object.entries(l.sub.populate)) {
        merged[k] = v
        hasMerged = true
      }
    }
  }
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
