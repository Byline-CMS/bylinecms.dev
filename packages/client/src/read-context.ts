/**
 * Bind one authenticated request identity to a logical ReadContext without
 * putting forgeable auth state on the public ReadContext shape. Each operation
 * gets an immutable clone carrying its effective read mode.
 */

import type { RequestContext } from '@byline/auth'
import type { ReadContext, ReadMode } from '@byline/core'

import type { BylineClient } from './client.js'

const requestContexts = new WeakMap<ReadContext, RequestContext>()

export async function resolveReadRequestContext(
  client: BylineClient<any>,
  readContext: ReadContext,
  readMode: ReadMode,
  supplied?: RequestContext
): Promise<RequestContext> {
  const base =
    requestContexts.get(readContext) ?? supplied ?? (await client.resolveRequestContext())
  if (!requestContexts.has(readContext)) requestContexts.set(readContext, base)
  return { ...base, readMode }
}
