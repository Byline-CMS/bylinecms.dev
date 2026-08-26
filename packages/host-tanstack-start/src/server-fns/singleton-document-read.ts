/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getAdminBylineClient } from '@byline/client/server'
import { getCollectionDefinition } from '@byline/core'

import { resolveAdminDocumentRead } from './admin-document-presentation.js'
import { serialise } from './serialise.js'

export interface SingletonDocumentReadInput {
  singleton: string
  locale?: string
  depth?: number
  populateRelations?: boolean
}

/**
 * Read the singleton document with the presentation controls shared by the
 * editor route and the public server function. Route-only lifecycle metadata
 * is deliberately composed one layer up, where host database and actor
 * context are available without widening the singleton transport contract.
 */
export async function readSingletonDocument(data: SingletonDocumentReadInput) {
  const handle = getAdminBylineClient().singleton(data.singleton)
  const { options } = resolveAdminDocumentRead(getCollectionDefinition(data.singleton), data)
  return serialise(await handle.get(options))
}
