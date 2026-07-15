/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import {
  type BeforeReadHookFn,
  type BeforeReadHookSlot,
  type CollectionDefinition,
  resolveHooks,
} from '../@types/collection-types.js'
import { ERR_READ_RECURSION, ERR_VALIDATION } from '../lib/errors.js'
import { type ParseContext, parsePredicateFilters } from '../query/parse-where.js'
import { createHookReadContext, getReadContextScope } from './read-context-scope.js'
import type { DocumentFilter, ReadContext } from '../@types/db-types.js'
import type { QueryPredicate } from '../@types/query-predicate.js'

interface ReadSecurityState {
  authorityToken: string
  domains: WeakMap<object, DomainSecurityState>
}

interface DomainSecurityState {
  definitions: WeakMap<CollectionDefinition, DefinitionSecurityState>
}

interface DefinitionSecurityState {
  modes: Map<string, BeforeReadCacheEntry>
}

interface BeforeReadCacheEntry {
  predicate?: Promise<QueryPredicate | null>
  compiledFilters?: Promise<DocumentFilter[] | undefined>
}

const readSecurityStates = new WeakMap<ReadContext, ReadSecurityState>()

/**
 * Resolve the per-collection `beforeRead` hook predicate for the current
 * request, with caching across populate fanout.
 *
 * Each configured hook function runs in declaration order. Predicates from
 * multiple hooks are combined with implicit AND. Results are cached in
 * module-private state bound to one request authority; caller-owned
 * `ReadContext` properties are never consulted for authorization.
 *
 * Returns `null` when no hook is configured, or every hook returned
 * void. Callers (`CollectionHandle`, `populateDocuments`) treat `null`
 * the same as "no scoping" — they pass nothing extra to the adapter.
 */
export async function applyBeforeRead(params: {
  definition: CollectionDefinition
  requestContext: RequestContext
  readContext: ReadContext
  /** Stable adapter/client identity. Defaults to the definition for direct callers. */
  securityDomain?: object
}): Promise<QueryPredicate | null> {
  const { definition, requestContext, readContext, securityDomain = definition } = params
  const collectionPath = definition.path
  const scope = getReadContextScope(readContext)
  const entry = getBeforeReadCacheEntry(scope.root, requestContext, securityDomain, definition)

  if (scope.ancestry.includes(entry)) {
    throw ERR_READ_RECURSION({
      message: `beforeRead recursion blocked for collection '${collectionPath}'`,
      details: { collectionPath, readMode: requestContext.readMode ?? 'any' },
    })
  }

  if (entry.predicate) return entry.predicate

  const pending = (async () => {
    const resolved = await resolveHooks(definition)
    const hooks = normalizeBeforeReadHook(resolved?.beforeRead)
    if (hooks.length === 0) return null

    const predicates: QueryPredicate[] = []
    for (const hook of hooks) {
      const result = await hook({
        collectionPath,
        requestContext,
        readContext: createHookReadContext(scope, entry),
      })
      if (result != null) predicates.push(result)
    }

    if (predicates.length === 0) return null
    if (predicates.length === 1) return predicates[0] ?? null
    return { $and: predicates }
  })()

  entry.predicate = pending
  return pending
}

/**
 * Resolve and strictly compile the security predicate once per logical read.
 * Promise caching also prevents concurrent populate branches from compiling
 * the same predicate or resolving its relation collection ids more than once.
 */
export async function compileBeforeReadFilters(params: {
  definition: CollectionDefinition
  requestContext: RequestContext
  readContext: ReadContext
  parseContext: ParseContext
  /** Stable identity shared by every fanout path using this adapter/client. */
  securityDomain: object
}): Promise<DocumentFilter[] | undefined> {
  const { definition, requestContext, readContext, parseContext, securityDomain } = params
  const scope = getReadContextScope(readContext)
  const entry = getBeforeReadCacheEntry(scope.root, requestContext, securityDomain, definition)

  if (scope.ancestry.includes(entry)) {
    throw ERR_READ_RECURSION({
      message: `beforeRead recursion blocked for collection '${definition.path}'`,
      details: {
        collectionPath: definition.path,
        readMode: requestContext.readMode ?? 'any',
      },
    })
  }

  if (entry.compiledFilters) return entry.compiledFilters

  const compiled = (async () => {
    const predicate = await applyBeforeRead({
      definition,
      requestContext,
      readContext,
      securityDomain,
    })
    if (predicate == null) return undefined
    const filters = await parsePredicateFilters(predicate, definition, parseContext, {
      strict: true,
    })
    return filters.length > 0 ? filters : undefined
  })()
  entry.compiledFilters = compiled
  return compiled
}

/** Bind a logical read to one immutable request authority. */
export function bindReadContextAuthority(
  readContext: ReadContext,
  requestContext: RequestContext
): void {
  getReadSecurityState(readContext, requestContext)
}

function getReadSecurityState(
  readContext: ReadContext,
  requestContext: RequestContext
): ReadSecurityState {
  const root = getReadContextScope(readContext).root
  const authorityToken = requestAuthorityToken(requestContext)
  const existing = readSecurityStates.get(root)
  if (existing) {
    if (existing.authorityToken !== authorityToken) {
      throw ERR_VALIDATION({
        message: 'ReadContext cannot be reused across request authorities',
      })
    }
    return existing
  }

  const state: ReadSecurityState = {
    authorityToken,
    domains: new WeakMap(),
  }
  readSecurityStates.set(root, state)
  return state
}

function getBeforeReadCacheEntry(
  readContext: ReadContext,
  requestContext: RequestContext,
  securityDomain: object,
  definition: CollectionDefinition
): BeforeReadCacheEntry {
  const state = getReadSecurityState(readContext, requestContext)
  let domain = state.domains.get(securityDomain)
  if (!domain) {
    domain = { definitions: new WeakMap() }
    state.domains.set(securityDomain, domain)
  }

  let definitionState = domain.definitions.get(definition)
  if (!definitionState) {
    definitionState = { modes: new Map() }
    domain.definitions.set(definition, definitionState)
  }

  const mode = requestContext.readMode ?? 'any'
  let entry = definitionState.modes.get(mode)
  if (!entry) {
    entry = {}
    definitionState.modes.set(mode, entry)
  }
  return entry
}

/**
 * `requestId` stays in the token deliberately. A `ReadContext` is a
 * per-logical-request object, and predicates cached on it may embed
 * request-time state (embargo cutoffs, preview windows), so reusing one
 * across requests must fail loudly even for the same actor. The flip side
 * is a contract on host adapters: a `RequestContext` factory must return
 * the same instance for every call within one logical request (see
 * `oncePerRequest` in `@byline/host-tanstack-start`) — a factory that
 * mints a fresh `requestId` per call makes any two reads sharing a
 * `ReadContext` throw the cross-authority error above.
 */
function requestAuthorityToken(requestContext: RequestContext): string {
  const actor = requestContext.actor
  if (actor == null) {
    return JSON.stringify([requestContext.requestId, requestContext.locale ?? null, 'anonymous'])
  }
  const realm = 'isSuperAdmin' in actor ? 'admin' : 'user'
  const isSuperAdmin = 'isSuperAdmin' in actor ? actor.isSuperAdmin : false
  return JSON.stringify([
    requestContext.requestId,
    requestContext.locale ?? null,
    realm,
    actor.id,
    isSuperAdmin,
    Array.from(actor.abilities).sort(),
  ])
}

/** Normalise a `beforeRead` slot (single function or array) into a flat array. */
function normalizeBeforeReadHook(slot: BeforeReadHookSlot | undefined): BeforeReadHookFn[] {
  if (!slot) return []
  return Array.isArray(slot) ? slot : [slot]
}
