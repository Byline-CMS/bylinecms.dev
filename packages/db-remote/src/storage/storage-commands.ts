/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, ICollectionCommands, IDocumentCommands } from '@byline/core'

/**
 * CollectionCommands
 */
export class CollectionCommands implements ICollectionCommands {
  async create(_path: string, _config: CollectionDefinition) {
    throw new Error('db-remote method not implemented')
  }

  async delete(_id: string) {
    throw new Error('db-remote method not implemented')
  }
}

/**
 * DocumentCommands
 */
export class DocumentCommands implements IDocumentCommands {
  /**
   * createDocumentVersion
   *
   * Creates a new document or a new version of an existing document.
   *
   * @param params - Options for creating the document
   * @returns The created document and the number of field values inserted
   */
  // @ts-expect-error
  async createDocumentVersion(_params: {
    documentId?: string // Optional logical document ID when creating a new version for the same logical document
    collectionId: string
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    path: string
    locale?: string
    status?: 'draft' | 'published' | 'archived'
    createdBy?: string
  }) {
    throw new Error('db-remote method not implemented')
  }
}
/**
 * Factory function
 * @param siteConfig
 * @param db
 * @returns
 */
export function createCommandBuilders(_db: null) {
  return {
    collections: new CollectionCommands(),
    documents: new DocumentCommands(),
  }
}
