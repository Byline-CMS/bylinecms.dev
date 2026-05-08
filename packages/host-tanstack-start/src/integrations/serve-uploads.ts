/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Runtime `/uploads/*` handler for TanStack Start + Nitro hosts.
 *
 * The local storage provider writes to a directory on disk; this helper
 * streams that directory back on every request so newly-uploaded files
 * appear without a rebuild.
 *
 * Why not `nitro.publicAssets`? `publicAssets` is a build-time copy
 * (`copyPublicAssets` in `nitro/_build/common.mjs`) and the static handler
 * reads from a virtual asset registry baked at build time
 * (`runtime/internal/static.mjs` → `getAsset(id)` from
 * `#nitro/virtual/public-assets`). Files written after the build never
 * land in that registry, so they 404 forever. A request-time handler is
 * the only correct shape for user-uploaded content.
 *
 * Usage in `src/server.ts`:
 *
 * ```ts
 * import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
 * import { serveUploads } from '@byline/host-tanstack-start/integrations/serve-uploads'
 *
 * export default createServerEntry({
 *   async fetch(request) {
 *     const upload = await serveUploads(request)
 *     if (upload) return upload
 *     return handler.fetch(request)
 *   },
 * })
 * ```
 *
 * The default-configured `serveUploads` matches
 * `localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' })`.
 * For a different directory or URL prefix, build your own with
 * `createUploadsHandler({ dir, prefix })`.
 */

import { readFile, stat } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'

export interface UploadsHandlerOptions {
  /**
   * URL prefix to match. Trailing slash required. Default `'/uploads/'`.
   * Must match the `baseUrl` you passed to `localStorageProvider`.
   */
  prefix?: string
  /**
   * Filesystem directory to serve. Default `<process.cwd()>/uploads`.
   * Must match the `uploadDir` you passed to `localStorageProvider`.
   */
  dir?: string
  /**
   * `Cache-Control` header. Default
   * `'public, max-age=31536000, immutable'` — safe because the local
   * provider UUID-prefixes filenames, so a given URL never points at
   * different bytes across uploads.
   */
  cacheControl?: string
  /**
   * Extra `extension → MIME type` entries merged on top of the built-in
   * map. Use this to add formats the default map doesn't cover.
   */
  mimeTypes?: Record<string, string>
}

const DEFAULT_MIME: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * Build a `/uploads/*` handler with custom configuration. Returns a
 * function suitable for use inside `createServerEntry({ fetch })` —
 * resolves to a `Response` when the request matched and the file
 * existed, and to `null` when the request should fall through to the
 * framework handler.
 */
export function createUploadsHandler(
  options: UploadsHandlerOptions = {}
): (request: Request) => Promise<Response | null> {
  const prefix = options.prefix ?? '/uploads/'
  const dir = resolvePath(options.dir ?? `${process.cwd()}/uploads`)
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE_CONTROL
  const mime = options.mimeTypes ? { ...DEFAULT_MIME, ...options.mimeTypes } : DEFAULT_MIME

  return async function serveUploadsHandler(request: Request): Promise<Response | null> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null

    const url = new URL(request.url)
    if (!url.pathname.startsWith(prefix)) return null

    let rel: string
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length))
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    if (!rel) return null

    // Path-traversal guard: `resolve` collapses `..` segments before we
    // compare. The resolved absolute path must stay within `dir`.
    const abs = resolvePath(dir, rel)
    if (abs !== dir && !abs.startsWith(`${dir}/`)) {
      return new Response('Forbidden', { status: 403 })
    }

    let info
    try {
      info = await stat(abs)
    } catch {
      return null // fall through to the framework handler / SPA 404
    }
    if (!info.isFile()) return null

    const dot = abs.lastIndexOf('.')
    const ext = dot >= 0 ? abs.slice(dot).toLowerCase() : ''
    const type = mime[ext] || 'application/octet-stream'

    const headers = new Headers({
      'Content-Type': type,
      'Content-Length': info.size.toString(),
      'Last-Modified': new Date(info.mtimeMs).toUTCString(),
      'Cache-Control': cacheControl,
    })

    if (request.method === 'HEAD') return new Response(null, { headers })
    const body = await readFile(abs)
    return new Response(body, { headers })
  }
}

/**
 * Default-configured `/uploads/*` handler. Matches
 * `localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' })`
 * — the shape produced by `@byline/cli` host scaffolding.
 *
 * Resolved at module-load time, which fixes `process.cwd()` to the
 * server's startup directory.
 */
export const serveUploads = createUploadsHandler()
