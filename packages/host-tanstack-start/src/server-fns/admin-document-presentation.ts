/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  buildRelationSummaryPopulateMap,
  type CollectionDefinition,
  getCollectionAdminConfig,
  getCollectionDefinition,
  type PopulateSpec,
} from '@byline/core'

export interface AdminDocumentReadInput {
  locale?: string
  depth?: number
  populateRelations?: boolean
}

export interface AdminDocumentReadOptions {
  locale: string
  populate?: PopulateSpec
  depth?: number
  status: 'any'
  onMissingLocale: 'empty'
  lenient: true
}

/**
 * Resolve the shared read controls used by collection and singleton editors.
 * Explicit depth is the API-preview mode; otherwise relation-summary mode
 * projects only each target's picker/title fields for first-paint tiles.
 */
export function resolveAdminDocumentRead(
  definition: CollectionDefinition | null,
  input: AdminDocumentReadInput
): { options: AdminDocumentReadOptions; populatedTree: boolean } {
  const populateRequested = typeof input.depth === 'number' && input.depth > 0
  const autoRelationsActive = !populateRequested && input.populateRelations === true

  let populate: PopulateSpec | undefined
  let depth: number | undefined
  if (populateRequested) {
    populate = '*'
    depth = input.depth
  } else if (autoRelationsActive && definition != null) {
    const populateMap = buildRelationSummaryPopulateMap(definition.fields, (targetPath) => ({
      def: getCollectionDefinition(targetPath),
      admin: getCollectionAdminConfig(targetPath),
    }))
    if (Object.keys(populateMap).length > 0) {
      populate = populateMap
      depth = 1
    }
  }

  return {
    options: {
      locale: input.locale ?? 'en',
      populate,
      depth,
      status: 'any',
      onMissingLocale: 'empty',
      lenient: true,
    },
    populatedTree: populateRequested || autoRelationsActive,
  }
}
