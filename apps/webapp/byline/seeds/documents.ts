/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getCollectionDefinition, getServerConfig, slugify } from '@byline/core'

// Complex test document with many fields and arrays. The system `path`
// is supplied separately to `createDocumentVersion` as a top-level
// argument — it is no longer a user-defined field.
const sampleDocument = {
  title: {
    en: 'My First Document',
    es: 'Mi Primer Documento',
  },
  summary: {
    en: 'This is a sample document for testing purposes.',
    es: 'Este es un documento de muestra para fines de prueba.',
  },
  // category: {
  //   target_collection_id: "cat-123",
  //   target_document_id: "electronics-audio"
  // },
  featured: false,
  publishedOn: new Date('2024-01-15T10:00:00'),
  content: [
    {
      _type: 'richTextBlock',
      richText: {
        en: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Some richtext here...',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
        es: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Aquí hay un campo de texto enriquecido...',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
      },
      constrainedWidth: true,
    },
    {
      _type: 'photoBlock',
      display: 'wide',
      alt: 'Some alt text here',
      caption: {
        en: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Here is a richtext field Here is a richtext field Here is a richtext field Here is a rich text field.',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
        es: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido.',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
      },
    },
  ],
  reviews: [
    {
      reviewItem: {
        rating: 5,
        comment: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Some review text here...',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
      },
    },
    {
      reviewItem: {
        rating: 3,
        comment: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Some review text here...',
                    type: 'text',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
                textFormat: 0,
                textStyle: '',
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
      },
    },
  ],
  links: [{ link: 'https://example.com' }, { link: 'https://another-example.com' }],
}

export async function seedDocuments(count = 1000) {
  const db = getServerConfig().db

  const collectionDefinition = getCollectionDefinition('docs')

  if (!collectionDefinition) {
    console.error('Collection definition not found for "docs"')
    return
  }

  const bulkDocsCollectionResult = await db.commands.collections.create(
    'docs',
    collectionDefinition
  )

  const bulkDocsCollection = {
    id: bulkDocsCollectionResult[0].id,
    name: bulkDocsCollectionResult[0].path,
    version: (bulkDocsCollectionResult[0].version as number | undefined) ?? 1,
  }

  console.log(`Created Docs Collection ${bulkDocsCollection.name}`)

  for (let i = 0; i < count; i++) {
    const docData = structuredClone(sampleDocument)
    docData.title.en = `A bulk created document. ${i + 1}` // Ensure unique names
    const seedPath = slugify(docData.title.en, {
      locale: 'en',
      collectionPath: 'docs',
    })
    await db.commands.documents.createDocumentVersion({
      collectionId: bulkDocsCollection.id,
      collectionVersion: bulkDocsCollection.version,
      collectionConfig: collectionDefinition,
      action: 'create',
      documentData: docData,
      path: seedPath,
    })
  }

  console.log(`  - seeded ${count} docs`)
}
