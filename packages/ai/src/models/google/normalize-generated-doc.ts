/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { GeneratedDoc } from '@/utils/convert-to-lexical'

const normalizeAlign = (value: unknown): 'start' | 'center' | 'right' => {
  if (value === 'start' || value === 'center' || value === 'right') return value
  if (value === 'left') return 'start'
  return 'start'
}

export const normalizeGeneratedDoc = (doc: unknown): GeneratedDoc => {
  const normalizeParagraph = (p: any) => {
    if (p && p.kind === 'paragraph') {
      p.align = normalizeAlign(p.align)
    }
  }

  const normalizeBlocks = (blocks: any[]) => {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue

      if (block.kind === 'paragraph') {
        normalizeParagraph(block)
        continue
      }

      if (block.kind === 'quote' && Array.isArray(block.blocks)) {
        normalizeBlocks(block.blocks)
        continue
      }

      if (block.kind === 'list' && Array.isArray(block.items)) {
        for (const item of block.items) {
          if (item && Array.isArray(item.blocks)) {
            for (const paragraph of item.blocks) normalizeParagraph(paragraph)
          }
        }
      }
    }
  }

  if (doc && typeof doc === 'object' && Array.isArray((doc as any).blocks)) {
    normalizeBlocks((doc as any).blocks)
  }

  return doc as GeneratedDoc
}
