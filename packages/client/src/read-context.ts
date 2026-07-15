/**
 * Bind one authenticated request identity to a logical ReadContext without
 * putting forgeable auth state on the public ReadContext shape. Each operation
 * gets an immutable clone carrying its effective read mode.
 */

import type { RequestContext } from '@byline/auth'
import type { CollectionDefinition, DocumentFilter, ReadContext, ReadMode } from '@byline/core'
import { bindReadContextAuthority, compileBeforeReadFilters } from '@byline/core'

import type { BylineClient } from './client.js'

const readSecurityDomains = new WeakMap<BylineClient<any>, object>()

export function getReadSecurityDomain(client: BylineClient<any>): object {
  let domain = readSecurityDomains.get(client)
  if (!domain) {
    domain = {}
    readSecurityDomains.set(client, domain)
  }
  return domain
}

export async function resolveReadRequestContext(
  client: BylineClient<any>,
  readContext: ReadContext,
  readMode: ReadMode,
  supplied?: RequestContext
): Promise<RequestContext> {
  const candidate = supplied ?? (await client.resolveRequestContext())
  const base = Object.freeze({ ...candidate })
  bindReadContextAuthority(readContext, base)
  return { ...base, readMode }
}

export function resolveReadSecurityFilters(
  client: BylineClient<any>,
  definition: CollectionDefinition,
  requestContext: RequestContext,
  readContext: ReadContext,
  bypass?: true
): Promise<DocumentFilter[] | undefined> {
  if (bypass) return Promise.resolve(undefined)
  return compileBeforeReadFilters({
    definition,
    requestContext,
    readContext,
    securityDomain: getReadSecurityDomain(client),
    parseContext: {
      collections: client.collections,
      resolveCollectionId: (path) => client.resolveCollectionId(path),
      logger: client.logger,
    },
  })
}
