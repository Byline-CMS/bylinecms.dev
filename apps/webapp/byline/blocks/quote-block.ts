/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'

/**
 * Reference block for the per-block schema/admin split. This file is the
 * schema half (React-free, tsx-loadable); its admin counterpart
 * (`./quote-block.admin.ts`) opts `quoteText` into a plain non-AI editor via
 * `defineBlockAdmin` while the site-wide richtext registration stays
 * AI-enabled — see `byline/admin.config.ts`.
 */
export const QuoteBlock = defineBlock({
  blockType: 'quoteBlock',
  label: 'Quote Block',
  helpText: 'A block for displaying a quotation with an optional highlight and source.',
  fields: [
    {
      name: 'highlightQuote',
      label: 'Highlight Quote',
      type: 'text',
      optional: true,
      localized: true,
      helpText: 'A short pull-quote line displayed above the quotation.',
    },
    {
      name: 'quoteText',
      label: 'Quote',
      type: 'richText',
      localized: true,
    },
    {
      name: 'source',
      label: 'Source',
      type: 'text',
      optional: true,
      helpText: 'Attribution for the quotation (person, publication, …). Not localized.',
    },
  ],
})

/**
 * Schema-local field-only data shape for forms or block helpers. Application
 * consumers should use the canonical generated block type.
 */
export type QuoteBlockFields = BlockFieldData<typeof QuoteBlock>

/**
 * Schema-local full block instance shape (`_id`, `_type` + fields). Application
 * renderers should use the generated `QuoteBlockData`.
 */
export type QuoteBlockData = BlockData<typeof QuoteBlock>
