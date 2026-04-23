/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getCollectionDefinition, getServerConfig, slugify } from '@byline/core'

const categories = [
  {
    name: { en: 'Whitepaper' },
    description: { en: 'In-depth articles and research papers.' },
  },
  {
    name: { en: 'Tutorial' },
    description: { en: 'Step-by-step guides and how-tos.' },
  },
  {
    name: { en: 'Framework' },
    description: { en: 'Libraries, frameworks, and toolkits.' },
  },
]

export async function seedCategories() {
  const db = getServerConfig().db

  const collectionDefinition = getCollectionDefinition('categories')

  if (!collectionDefinition) {
    console.error('Collection definition not found for "categories"')
    return
  }

  // `initBylineCore` already registered the collection row via
  // `ensureCollections()` when byline.server.config was imported, so we
  // look the row up rather than re-inserting (which would violate the
  // unique-path constraint).
  const existing = await db.queries.collections.getCollectionByPath('categories')
  if (!existing) {
    throw new Error(
      "seedCategories: expected the 'categories' collection to be registered by initBylineCore()"
    )
  }

  const categoriesCollection = {
    id: existing.id as string,
    name: existing.path as string,
    version: (existing.version as number | undefined) ?? 1,
  }

  console.log(`Seeding into Categories collection (${categoriesCollection.name})`)

  for (const category of categories) {
    const seedPath = slugify(category.name.en, {
      locale: 'en',
      collectionPath: 'categories',
    })
    await db.commands.documents.createDocumentVersion({
      collectionId: categoriesCollection.id,
      collectionVersion: categoriesCollection.version,
      collectionConfig: collectionDefinition,
      action: 'create',
      documentData: category,
      path: seedPath,
    })
    console.log(`  - seeded category: ${category.name.en} (${seedPath})`)
  }
}
