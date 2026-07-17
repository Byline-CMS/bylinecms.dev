/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Fixture: one `pages` document carrying an FAQ block with two Q&A items.
 *
 * Provides a stable, item-carrying FAQ block for the e2e suite — the
 * block-admin-override spec asserts against this document's item order and
 * answer content (dotted schema-path override `faq.answer` in
 * faq-block.admin.ts), so editor flows that mutate items use their own
 * throwaway documents instead (see array-in-block.spec.ts).
 *
 * Run directly: `cd apps/webapp && pnpm tsx byline/seeds/faq-fixture.ts`
 * (idempotent — skips creation when the fixture path already exists).
 */

// Initialize Byline config when run directly (imports are hoisted, so
// keep these first).
import '../load-env.js'
import '../server.config.js'

import { getCollectionDefinition, getDefaultStatus, getServerConfig, slugify } from '@byline/core'

const lexicalParagraph = (text: string) => ({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text,
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
})

const FIXTURE_TITLE = 'FAQ fixture (arrays in blocks)'

export async function seedFaqFixture(): Promise<void> {
  const db = getServerConfig().db
  const collectionDefinition = getCollectionDefinition('pages')
  if (!collectionDefinition) {
    throw new Error("seedFaqFixture: collection definition not found for 'pages'")
  }

  const existing = await db.queries.collections.getCollectionByPath('pages')
  if (!existing) {
    throw new Error(
      "seedFaqFixture: expected the 'pages' collection to be registered by initBylineCore()"
    )
  }

  const path = slugify(FIXTURE_TITLE, { locale: 'en', collectionPath: 'pages' })

  const already = await db.queries.documents.getDocumentByPath({
    collection_id: existing.id as string,
    path,
    reconstruct: false,
  })
  if (already) {
    console.log(`  - faq fixture already present at pages/${path}`)
    return
  }

  await db.commands.documents.createDocumentVersion({
    collectionId: existing.id as string,
    collectionVersion: (existing.version as number | undefined) ?? 1,
    collectionConfig: collectionDefinition,
    action: 'create',
    documentData: {
      title: { en: FIXTURE_TITLE },
      summary: { en: 'Seeded fixture for the FAQ block (array field nested inside a block).' },
      area: 'root',
      publishedOn: new Date(),
      content: [
        {
          _type: 'faqBlock',
          faq: [
            {
              question: { en: 'What is Byline?' },
              answer: { en: lexicalParagraph('Byline is an AI-first, open-source headless CMS.') },
            },
            {
              question: { en: 'Is it open source?' },
              answer: { en: lexicalParagraph('Yes — licensed MPL-2.0.') },
            },
          ],
        },
      ],
    },
    path,
    status: getDefaultStatus(collectionDefinition),
  })

  console.log(`  - seeded faq fixture at pages/${path}`)
}

// Allow direct execution.
const isDirectRun = process.argv[1]?.endsWith('faq-fixture.ts')
if (isDirectRun) {
  seedFaqFixture().then(
    () => process.exit(0),
    (err) => {
      console.error(err)
      process.exit(1)
    }
  )
}
