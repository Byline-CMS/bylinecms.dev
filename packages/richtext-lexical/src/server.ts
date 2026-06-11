/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side entry points for the Lexical adapter — registered into
 * `ServerConfig.fields.richText.{ populate, embed }`. No React, no DOM,
 * no Lexical runtime — safe to import from server-only modules.
 *
 * Two factories, one shared visitor pipeline. The visitors themselves
 * (link, inline-image) don't care whether they're firing on read or
 * save; what differs is *when* the framework runs them.
 *
 * @example
 * ```ts
 * // apps/webapp/byline/server.config.ts
 * import {
 *   lexicalEditorEmbedServer,
 *   lexicalEditorPopulateServer,
 * } from '@byline/richtext-lexical/server'
 * import { defineServerConfig } from '@byline/core'
 * import { getAdminBylineClient } from '@/lib/byline-client'
 *
 * defineServerConfig({
 *   // …
 *   fields: {
 *     richText: {
 *       embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
 *       populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
 *     },
 *   },
 * })
 * ```
 */

import type { BylineClient } from '@byline/client'
import type {
  RichTextEmbedContext,
  RichTextEmbedFn,
  RichTextPopulateContext,
  RichTextPopulateFn,
  RichTextToMarkdownFn,
} from '@byline/core'

import { inlineImageVisitor } from './field/extensions/inline-image/populate'
import { linkVisitor } from './field/extensions/link/populate'
import { type LexicalNodeVisitor, runLexicalPopulate } from './field/lexical-populate-shared'

// ---------------------------------------------------------------------------
// Schema-data re-exports — data-only Lexical config that's safe to evaluate
// outside Vite (e.g. tsx-loaded seeds). Importing these from the root barrel
// (`@byline/richtext-lexical`) drags in `RichTextField` / `EditorField` and
// their CSS imports; the `/server` subpath stays React-free.
// ---------------------------------------------------------------------------
export { defaultEditorConfig } from './field/config/default'
export {
  type LexicalToMarkdownOptions,
  type LexicalToMarkdownResult,
  type LexicalToMarkdownWarning,
  lexicalToMarkdown,
} from './field/markdown/lexical-to-markdown'

import {
  type LexicalToMarkdownOptions,
  lexicalToMarkdown,
} from './field/markdown/lexical-to-markdown'

export { inlineImageVisitor } from './field/extensions/inline-image/populate'
export { linkVisitor } from './field/extensions/link/populate'
export type { EditorConfig, EditorSettings, EditorSettingsOverride } from './field/config/types'
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
   * call so registration order doesn't matter.
   */
  getClient: () => BylineClient
  /**
   * Override the visitor list. Defaults to every visitor the package
   * ships — currently `[inlineImageVisitor, linkVisitor]`. Useful when a
   * host wants to register additional custom visitors alongside the
   * built-ins, or temporarily disable a built-in:
   *
   * ```ts
   * lexicalEditorPopulateServer({
   *   getClient,
   *   visitors: [inlineImageVisitor, linkVisitor, myCustomVisitor],
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
export function lexicalEditorPopulateServer(options: LexicalServerOptions): RichTextPopulateFn {
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

/**
 * Build the registered `RichTextEmbedFn`. Mirror of
 * `lexicalEditorPopulateServer` — same visitor pipeline, fires from the
 * write path instead of the read path. The framework invokes this
 * function once per rich-text leaf in the outgoing document data,
 * gated by each leaf field's `embedRelationsOnSave` (default: `true`).
 *
 * The visitors mutate `ctx.value` in place (refreshing `document.path`,
 * `document.title`, and `_resolved` on internal-link nodes; the inline-
 * image bag on inline-image nodes). The lifecycle write path catches
 * per-leaf errors and leaves the leaf untouched on hard failure (branch
 * C of docs/RICHTEXT-LINK-REFACTOR-STRATEGY.md § 3.3).
 */
/**
 * One-way markdown serializer for the agent-readable export surface,
 * shaped for `ServerConfig.fields.richText.toMarkdown`. The sibling of
 * `lexicalEditorPopulateServer` / `lexicalEditorEmbedServer` — but pure
 * and synchronous: it walks the stored editor JSON with
 * `lexicalToMarkdown` and performs no reads. See that function's header
 * for the dialect contract (GFM alerts, lossy-OK).
 */
export function lexicalEditorToMarkdownServer(
  options: LexicalToMarkdownOptions = {}
): RichTextToMarkdownFn {
  return (ctx) => lexicalToMarkdown(ctx.value, options).markdown
}

export function lexicalEditorEmbedServer(options: LexicalServerOptions): RichTextEmbedFn {
  const visitors = options.visitors ?? [inlineImageVisitor, linkVisitor]
  return async (ctx: RichTextEmbedContext): Promise<void> => {
    await runLexicalPopulate({
      client: options.getClient(),
      readContext: ctx.readContext,
      visitors,
      values: [ctx.value],
    })
  }
}
