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
 * The schema sidesteps that by putting the dynamic import inside TanStack
 * Start's server-only function rather than using an inline object:
 *
 *     // schema.ts → the image field's upload block
 *     const loadHooks = createServerOnlyFn(() => import('./hooks.js'))
 *     upload: { …, hooks: loadHooks }
 *
 * The transform removes the loader body and this file's import graph from the
 * client bundle. `@byline/core` resolves it once on the server and runs
 * these hooks exactly as it would inline ones.
 *
 * The upshot: **inside this file you may statically import anything
 * server-only.** The `node:crypto` import below is the demonstration — that
 * same import at the top of `schema.ts` would crash the dev server; here it
 * is safe. See docs/04-collections/index.md → "Hooks must not statically import
 * server-only code".
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
