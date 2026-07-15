import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RenderBlocks } from './render-blocks'
import type { PopulatedContentBlock } from '@/lib/content-types'

describe('RenderBlocks', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports and omits an unknown runtime block type', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const block = { _id: 'unknown', _type: 'videoBlock' } as unknown as PopulatedContentBlock

    const output = RenderBlocks({ blocks: [block], lng: 'en' })

    expect(report).toHaveBeenCalledWith('Unsupported content block type: "videoBlock"')
    expect(renderToStaticMarkup(output)).toBe('')
  })

  it('continues rendering known blocks after an unknown block', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unknown = { _id: 'unknown', _type: 'videoBlock' } as unknown as PopulatedContentBlock
    const richText = {
      _id: 'known',
      _type: 'richTextBlock',
      richText: { root: { children: [] } },
    } satisfies PopulatedContentBlock

    expect(
      renderToStaticMarkup(RenderBlocks({ blocks: [unknown, richText], lng: 'en' }))
    ).toContain('rich-text-block')
  })
})
