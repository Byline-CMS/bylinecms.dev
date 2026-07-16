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

  it('renders a code block with its language and caption', () => {
    const code = {
      _id: 'code1',
      _type: 'codeBlock',
      language: 'typescript',
      code: 'const answer: number = 42',
      caption: 'The answer',
    } satisfies PopulatedContentBlock

    const markup = renderToStaticMarkup(RenderBlocks({ blocks: [code], lng: 'en' }))
    expect(markup).toContain('code-block')
    expect(markup).toContain('answer')
    expect(markup).toContain('The answer')
  })

  it('renders a quote block with highlight and source', () => {
    const quote = {
      _id: 'quote1',
      _type: 'quoteBlock',
      highlightQuote: 'A memorable line',
      quoteText: { root: { children: [] } },
      source: 'A. Author',
    } satisfies PopulatedContentBlock

    const markup = renderToStaticMarkup(RenderBlocks({ blocks: [quote], lng: 'en' }))
    expect(markup).toContain('quote-block')
    expect(markup).toContain('A memorable line')
    expect(markup).toContain('A. Author')
  })
})
