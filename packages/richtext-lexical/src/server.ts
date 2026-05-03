/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side entry point for the Lexical adapter — registered into
 * `ServerConfig.fields.richText.populate`. No React, no DOM, no Lexical
 * runtime — safe to import from server-only modules.
 *
 * @example
 * ```ts
 * // apps/webapp/byline/server.config.ts
 * import { lexicalEditorServer } from '@byline/richtext-lexical/server'
 * import { defineServerConfig } from '@byline/core'
 * import { getAdminBylineClient } from '@/lib/byline-client'
 *
 * defineServerConfig({
 *   // …
 *   fields: {
 *     richText: { populate: lexicalEditorServer({ getClient: getAdminBylineClient }) },
 *   },
 * })
 * ```
 */

import type { BylineClient } from '@byline/client'
import type { RichTextPopulateContext, RichTextPopulateFn } from '@byline/core'

import { type LexicalNodeVisitor, runLexicalPopulate } from './field/lexical-populate-shared'
import { inlineImageVisitor } from './field/plugins/inline-image-plugin/populate'
import { linkVisitor } from './field/plugins/link-plugin/populate'

export { inlineImageVisitor } from './field/plugins/inline-image-plugin/populate'
export { linkVisitor } from './field/plugins/link-plugin/populate'
export type {
  LexicalNodeLike,
  LexicalNodeVisitor,
  PendingHydration,
} from './field/lexical-populate-shared'

export interface LexicalServerOptions {
  /**
   * Returns the server-side `BylineClient` used to batch-fetch target
   * documents. Typically the host application's cached singleton (e.g.
   * `getAdminBylineClient` in the webapp). Resolved lazily on every
   * populate call so registration order doesn't matter.
   */
  getClient: () => BylineClient
  /**
   * Override the visitor list. Defaults to every visitor the package
   * ships — currently `[inlineImageVisitor, linkVisitor]`. Useful when a
   * host wants to register additional custom visitors alongside the
   * built-ins, or temporarily disable a built-in:
   *
   * ```ts
   * lexicalEditorServer({
   *   getClient,
   *   visitors: [inlineImageVisitor, linkVisitor, myCustomEmbedVisitor],
   * })
   * ```
   */
  visitors?: LexicalNodeVisitor[]
}

/**
 * Build the registered `RichTextPopulateFn`. Composes every supplied
 * visitor and runs them in a single tree walk per call. The framework
 * invokes this function once per rich-text leaf it discovers in a
 * document tree, gated by each leaf field's `populateRelationsOnRead`.
 */
export function lexicalEditorServer(options: LexicalServerOptions): RichTextPopulateFn {
  const visitors = options.visitors ?? [inlineImageVisitor, linkVisitor]
  return async (ctx: RichTextPopulateContext): Promise<void> => {
    await runLexicalPopulate({
      client: options.getClient(),
      readContext: ctx.readContext,
      visitors,
      values: [ctx.value],
    })
  }
}
