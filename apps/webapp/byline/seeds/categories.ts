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

  const categoriesCollectionResult = await db.commands.collections.create(
    'categories',
    collectionDefinition
  )

  const categoriesCollection = {
    id: categoriesCollectionResult[0].id,
    name: categoriesCollectionResult[0].path,
  }

  console.log(`Created Categories Collection ${categoriesCollection.name}`)

  for (const category of categories) {
    const seedPath = slugify(category.name.en, {
      locale: 'en',
      collectionPath: 'categories',
    })
    await db.commands.documents.createDocumentVersion({
      collectionId: categoriesCollection.id,
      collectionConfig: collectionDefinition,
      action: 'create',
      documentData: category,
      path: seedPath,
    })
    console.log(`  - seeded category: ${category.name.en} (${seedPath})`)
  }
}
