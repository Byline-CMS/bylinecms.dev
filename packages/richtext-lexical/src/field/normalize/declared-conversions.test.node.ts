import { describe, expect, it } from 'vitest'

import { conversionFor, DECLARED_CONVERSIONS } from './declared-conversions'

describe('declared conversions', () => {
  it('declares one for every structure the spec lists as supported', () => {
    for (const type of [
      'heading',
      'quote',
      'code',
      'listitem',
      'table',
      'tablerow',
      'tablecell',
      'list',
      'layout-container',
      'layout-item',
      'admonition',
      'link',
      'autolink',
      'horizontalrule',
    ]) {
      expect(conversionFor(type), type).toBeDefined()
    }
  })

  it('declares none for media, embeds or unknown types', () => {
    for (const type of ['inline-image', 'youtube', 'vimeo', 'acme-custom-node']) {
      expect(conversionFor(type), type).toBeUndefined()
    }
  })

  it('classifies each structure by what it contains', () => {
    expect(DECLARED_CONVERSIONS.heading.kind).toBe('to-paragraph')
    expect(DECLARED_CONVERSIONS.listitem.kind).toBe('to-paragraph')
    expect(DECLARED_CONVERSIONS.table.kind).toBe('lift-blocks')
    expect(DECLARED_CONVERSIONS.list.kind).toBe('lift-blocks')
    expect(DECLARED_CONVERSIONS.link.kind).toBe('unwrap-inline')
  })

  it('preserves the admonition title', () => {
    expect(
      DECLARED_CONVERSIONS.admonition.preserveText({ type: 'admonition', title: 'Note title' })
    ).toBe('Note title')
    expect(DECLARED_CONVERSIONS.admonition.preserveText({ type: 'admonition' })).toBeUndefined()
  })

  it('preserves the link URL from either serialized shape', () => {
    // v1 stored `url` at the top level; v2 nests it under `attributes`.
    expect(DECLARED_CONVERSIONS.link.preserveText({ type: 'link', url: 'https://a.test' })).toBe(
      'https://a.test'
    )
    expect(
      DECLARED_CONVERSIONS.link.preserveText({
        type: 'link',
        attributes: { url: 'https://b.test' },
      })
    ).toBe('https://b.test')
    expect(DECLARED_CONVERSIONS.link.preserveText({ type: 'link' })).toBeUndefined()
  })

  it('drops a horizontal rule without inventing text', () => {
    const rule = conversionFor('horizontalrule')
    expect(rule?.kind).toBe('drop')
    expect(rule?.preserveText).toBeUndefined()
  })
})
