/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * OPTIONAL cross-instance cache invalidation for multi-machine deployments
 * (Fly.io and similar). Off by default — gated by `cache.clusterEnabled`.
 *
 * The L1 cache lives inside a single origin process. When the app runs as
 * more than one always-on instance, invalidating a tag on instance A leaves
 * B's copy untouched until it expires on its own TTL. For most Byline
 * deployments (single origin behind a CDN, short TTL) that drift is
 * invisible and this module stays disabled — see docs/DATA-CACHE-DESIGN.md
 * → "Clustering".
 *
 * When enabled, this resolves the Fly private-network (6PN) peers via Fly's
 * internal DNS and calls each instance's local invalidation endpoint. It is
 * designed to be invoked **fire-and-forget**: callers must not await it on
 * the editor's critical path (see `index.ts`), and a peer failure is logged
 * but never thrown — local invalidation has already succeeded by then.
 *
 * Peers are contacted in parallel (`Promise.allSettled`), and the
 * originating instance is harmlessly included in its own DNS result (it just
 * re-invalidates a tag it already cleared).
 */

import { Resolver } from 'node:dns'

import { getServerConfig } from '@/config'

export interface ClusterInvalidationResult {
  ip: string
  status: 'success' | 'failed'
  data?: unknown
  error?: string
}

async function resolveInternalDNS(domain: string): Promise<string[]> {
  const resolver = new Resolver()
  resolver.setServers(['[fdaa::3]']) // Fly.io's internal DNS server.
  return new Promise<string[]>((resolve, reject) => {
    resolver.resolve6(domain, (err, addresses) => {
      if (err) return reject(err)
      resolve(addresses)
    })
  })
}

export async function invalidateClusterCacheTag(tag: string): Promise<ClusterInvalidationResult[]> {
  return invalidateClusterCache(tag, 'tag')
}

export async function invalidateClusterCacheKey(key: string): Promise<ClusterInvalidationResult[]> {
  return invalidateClusterCache(key, 'key')
}

async function invalidateClusterCache(
  value: string,
  type: 'tag' | 'key'
): Promise<ClusterInvalidationResult[]> {
  const { cache } = getServerConfig()
  const domain = cache.privateNetworkDomain
  const port = cache.privateNetworkApplicationPort

  if (domain == null || port == null) {
    console.error(
      '[cache/cluster] clusterEnabled but PRIVATE_NETWORK_DOMAIN / PRIVATE_NETWORK_APPLICATION_PORT are unset; skipping fan-out'
    )
    return [{ ip: 'unknown', status: 'failed', error: 'cluster network config missing' }]
  }

  let ipv6Addresses: string[]
  try {
    ipv6Addresses = await resolveInternalDNS(domain)
  } catch (error) {
    console.error('[cache/cluster] DNS resolution failed', error)
    return [{ ip: 'unknown', status: 'failed', error: 'DNS resolution failed' }]
  }

  if (ipv6Addresses.length === 0) {
    return [{ ip: 'unknown', status: 'failed', error: 'no ipv6 addresses resolved' }]
  }

  const queryString =
    type === 'tag' ? `tag=${encodeURIComponent(value)}` : `key=${encodeURIComponent(value)}`

  const results = await Promise.allSettled(
    ipv6Addresses.map(async (ip): Promise<ClusterInvalidationResult> => {
      const url = `http://[${ip}]:${port}/api/cache/invalidate?${queryString}`
      const response = await fetch(url)
      if (!response.ok) {
        return { ip, status: 'failed', error: `HTTP ${response.status} ${response.statusText}` }
      }
      return { ip, status: 'success', data: await response.json().catch(() => undefined) }
    })
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ip: ipv6Addresses[i], status: 'failed', error: String(r.reason) }
  )
}
