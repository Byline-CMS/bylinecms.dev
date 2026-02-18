/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// Initialize Byline config by importing the server config
import 'dotenv/config'
import '../byline.server.config.js'

import { getCollectionDefinition, getServerConfig } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

// Complex test document with many fields and arrays
const sampleDocument = {
  path: 'my-first-bulk-document',
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
      richTextBlock: [
        {
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
        },
        { constrainedWidth: true },
      ],
    },
    {
      photoBlock: [
        { display: 'wide' },
        {
          photo: {
            file_id: uuidv7(),
            filename: 'docs-photo-01.jpg',
            original_filename: 'some-original-filename.jpg',
            mime_type: 'image/jpeg',
            file_size: 123456,
            storage_provider: 'local',
            storage_path: 'uploads/docs-photo-01.jpg',
          },
        },
        { alt: 'Some alt text here' },
        {
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
    },
  ],
  reviews: [
    {
      reviewItem: [
        { rating: 5 },
        {
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
      ],
    },
    {
      reviewItem: [
        { rating: 3 },
        {
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
      ],
    },
  ],
  links: [{ link: 'https://example.com' }, { link: 'https://another-example.com' }],
}

async function run() {
  const db = getServerConfig().db

  const collectionDefinition = getCollectionDefinition('docs')

  if (!collectionDefinition) {
    console.error('Collection definition not found for "docs"')
    return
  }

  // Create bulk documents to populate the database.
  const bulkDocsCollectionResult = await db.commands.collections.create(
    'docs',
    collectionDefinition
  )

  const bulkDocsCollection = {
    id: bulkDocsCollectionResult[0].id,
    name: bulkDocsCollectionResult[0].path,
  }

  console.log(`Created Bulk Docs Collection ${bulkDocsCollection}`)

  for (let i = 0; i < 1000; i++) {
    const docData = structuredClone(sampleDocument)
    docData.path = `my-first-bulk-document-${12345 + i}`
    docData.title.en = `A bulk created document. ${i + 1}` // Ensure unique names
    await db.commands.documents.createDocumentVersion({
      collectionId: bulkDocsCollection.id,
      collectionConfig: collectionDefinition,
      action: 'create',
      documentData: docData,
      path: docData.path,
    })
  }
}

run()
