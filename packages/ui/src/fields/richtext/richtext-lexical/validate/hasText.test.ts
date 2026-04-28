import type {
  SerializedEditorState,
  SerializedLexicalNode,
  SerializedParagraphNode,
  SerializedRootNode,
  SerializedTextNode,
} from 'lexical'
import { describe, expect, it } from 'vitest'

import { hasText } from './hasText'

type State = SerializedEditorState<SerializedLexicalNode>

import { createEmptyEditorState } from './createEmptyEditorState'

function rootState(children: SerializedRootNode['children']): State {
  return {
    root: {
      children,
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    } as SerializedRootNode,
  }
}

function emptyParagraph(
  children: SerializedParagraphNode['children'] = []
): SerializedParagraphNode {
  return {
    children,
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  } as SerializedParagraphNode
}

function textNode(text: string): SerializedTextNode {
  return {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  } as SerializedTextNode
}

describe('hasText', () => {
  it('returns false for null/undefined', () => {
    expect(hasText(null)).toBe(false)
    expect(hasText(undefined)).toBe(false)
  })

  it('returns false when root has no children', () => {
    expect(hasText(rootState([]))).toBe(false)
  })

  it('returns false for createEmptySerializedEditorState()', () => {
    expect(hasText(createEmptyEditorState())).toBe(false)
  })

  it('returns false for a single empty paragraph (no children)', () => {
    expect(hasText(rootState([emptyParagraph([])]))).toBe(false)
  })

  it('returns false for a single empty paragraph with one empty text node', () => {
    expect(hasText(rootState([emptyParagraph([textNode('')])]))).toBe(false)
  })

  it('returns true for a single paragraph with non-empty text', () => {
    expect(hasText(rootState([emptyParagraph([textNode('Hello')])]))).toBe(true)
  })

  it('returns true when there are multiple root children', () => {
    expect(
      hasText(
        rootState([emptyParagraph([textNode('')]), emptyParagraph([textNode('Still counts')])])
      )
    ).toBe(true)
  })
})
