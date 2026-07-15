/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only upload hooks for the `media` collection's `image` field.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Why this file exists (the affordance)
 * ──────────────────────────────────────────────────────────────────────────
 * `beforeStore` / `afterStore` are declared on a field's `upload` block,
 * which lives inside the collection *schema* (`./schema.ts`). That schema is
 * **isomorphic** — Byline bundles it into the browser admin as well as the
 * server. So, exactly like collection-level `hooks`, an upload hook declared
 * inline drags whatever it statically imports into the client bundle.
 *
 * Storage hooks are the *most* likely place to need server-only code — a
 * storage SDK (`@aws-sdk/client-s3`), `sharp`, an antivirus scanner, a
 * checksum/EXIF library, `node:crypto`/`node:fs`. Declaring them inline would
 * pull that graph into the browser (silent in `build`, a `node:* externalized`
 * crash in `dev`).
 *
 * The schema sidesteps that by carrying no hook import. The server-only hook
 * registry owns the dynamic loader instead:
 *
 *     // ../server-hooks.ts
 *     uploads: { 'media.image': () => import('./media/hooks.js') }
 *
 * Only `server.config.ts` imports that registry. `@byline/core` attaches and
 * resolves the loader on the server and runs these hooks exactly as it would
 * definition-attached hooks.
 *
 * The upshot: **inside this file you may statically import anything
 * server-only.** The `node:crypto` import below is the demonstration — that
 * same import at the top of `schema.ts` would crash the dev server; here it
 * is safe. See docs/04-collections/index.md → "Server-only hook registry".
 */

import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'

import type { AfterStoreContext, BeforeStoreContext, UploadHooks } from '@byline/core'

export default {
  // Rename every upload to a collision-proof, content-agnostic key before it
  // is written to storage — a realistic use of server-only code. Returning a
  // `{ filename }` override threads through `storage.upload(...)`, so the
  // generated image variants inherit the new prefix automatically.
  beforeStore: (ctx: BeforeStoreContext) => {
    const ext = extname(ctx.filename).toLowerCase()
    const filename = `${randomUUID()}${ext}`
    console.log(`beforeStore: renaming "${ctx.filename}" → "${filename}" (${ctx.mimeType})`)
    return { filename }
  },
  // Fires after the original and every Sharp variant have been written.
  // A real app might warm a CDN cache or enqueue post-processing here.
  afterStore: (ctx: AfterStoreContext) => {
    const variantCount = ctx.storedFile.variants?.length ?? 0
    console.log(
      `afterStore: stored "${ctx.storedFile.filename}" in ${ctx.collectionPath} with ${variantCount} variant(s)`
    )
  },
} satisfies UploadHooks
