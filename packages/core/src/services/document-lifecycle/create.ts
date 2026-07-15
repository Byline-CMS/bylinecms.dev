/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { normaliseDateFields } from '../../utils/normalise-dates.js'
import { slugify } from '../../utils/slugify.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import { normalizeNumericFields } from '../normalize-numeric-fields.js'
import {
  actorId,
  appendTreeRoot,
  applyRichTextEmbed,
  derivePath,
  extractDocumentId,
  extractVersionId,
  invokeHook,
  maybeAppendOrderKey,
  rethrowPathConflict,
} from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface CreateDocumentResult {
  documentId: string
  documentVersionId: string
}

/**
 * Create a new document.
 *
 * Flow:
 *   1. Default-locale enforcement: reject if `params.locale` is anything
 *      other than the configured default content locale (a brand-new
 *      document's canonical `path` lives in the default locale).
 *   2. Normalize date and numeric fields
 *   3. `hooks.beforeCreate({ data, collectionPath })`, then normalize numerics again
 *   4. Resolve `path` — explicit `params.path` → derive via `useAsPath`
 *      → UUID fallback.
 *   5. `db.commands.documents.createDocumentVersion(...)` (action = 'create')
 *   6. `hooks.afterCreate({ data, collectionPath, documentId, documentVersionId })`
 */
export async function createDocument(
  ctx: DocumentLifecycleContext,
  params: {
    data: Record<string, any>
    locale?: string
    status?: string
    /**
     * Explicit, user-supplied path (e.g. from the admin sidebar widget
     * or an SDK caller importing legacy content). When omitted, the
     * lifecycle derives the value from `definition.useAsPath`.
     */
    path?: string
    /**
     * The editorial advertised-locale set (from the admin available-locales
     * sidebar widget). Document-grain and sticky like `path`: passed straight
     * to the storage primitive, which replaces the document's rows wholesale.
     * `undefined` writes nothing (a new document starts with an empty set —
     * the safe opt-in default); `[]` clears it. See docs/07-internationalization/index.md.
     */
    availableLocales?: string[]
  }
): Promise<CreateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'createDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'create')
      const slugifier = ctx.slugifier ?? slugify
      const hooks = await resolveHooks(definition)
      const data = params.data

      if (params.locale != null && params.locale !== defaultLocale) {
        throw ERR_VALIDATION({
          message: `documents must be created in the default content locale ('${defaultLocale}'); received '${params.locale}'. Create the default-locale version first, then add localised versions via update.`,
          details: { defaultLocale, providedLocale: params.locale, collectionPath },
        }).log(ctx.logger)
      }

      normaliseDateFields(data)
      normalizeNumericFields(definition.fields, data)

      await invokeHook(hooks?.beforeCreate, { data, collectionPath })
      normalizeNumericFields(definition.fields, data)

      // Allocate counter-field values after beforeCreate so user-land hooks
      // can run their own logic on the raw payload, but before the flatten/
      // insert pass so the assigned values are persisted on the same write.
      // Caller-supplied counter values are overwritten — counters are
      // allocator-assigned, never user-set.
      await assignCounterValues({
        fields: definition.fields,
        data,
        counters: db.commands.counters,
      })

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const resolvedPath = explicitPath ?? derivePath(definition, data, defaultLocale, slugifier)

      // Append-at-end order_key for `orderable: true` collections.
      // Computed before the insert so the single createDocumentVersion call
      // carries the key into the byline_documents row. No effect when the
      // admin config opts out or isn't registered.
      const orderKey = await maybeAppendOrderKey(ctx, collectionPath)

      // Refresh embedded relation envelopes inside rich-text fields
      // (internal-link / inline-image nodes) before flatten-and-persist.
      await applyRichTextEmbed(ctx, data)

      const result = await db.commands.documents
        .createDocumentVersion({
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'create',
          documentData: data,
          path: resolvedPath,
          availableLocales: params.availableLocales,
          status: params.status ?? data.status ?? getDefaultStatus(definition),
          locale: params.locale ?? defaultLocale,
          orderKey,
          createdBy: actorId(ctx),
        })
        .catch((err: unknown) => rethrowPathConflict(err, resolvedPath, defaultLocale))

      const documentId = extractDocumentId(result.document)
      const documentVersionId = extractVersionId(result.document)

      // `tree: true` collections place every document in the tree by default:
      // a new document is appended as a root (a top-level nav entry) so it is
      // never stranded in the "unplaced" limbo. This is a system step of create
      // (the actor already passed the `create` ability), so it calls the storage
      // command directly — no `update` re-assertion, no separate tree event
      // (afterCreate covers invalidation). Post-version and best-effort: a
      // failure leaves the document created-but-unplaced and is logged, not
      // thrown. See docs/04-collections/03-document-trees.md.
      if (definition.tree === true) {
        try {
          await appendTreeRoot(ctx, documentId)
        } catch (err: unknown) {
          ctx.logger.error({ err, documentId }, 'failed to auto-place new document in tree')
        }
      }

      await invokeHook(hooks?.afterCreate, {
        data,
        collectionPath,
        documentId,
        documentVersionId,
        path: resolvedPath,
      })

      return { documentId, documentVersionId }
    }
  )
}
