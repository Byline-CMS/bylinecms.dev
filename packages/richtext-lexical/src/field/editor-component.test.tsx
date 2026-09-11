import { act } from 'react'

import type {
  SerializedEditorState,
  SerializedElementNode,
  SerializedRootNode,
  SerializedTextNode,
} from 'lexical'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./editor-component.css', () => ({}))
vi.mock('./themes/lexical-editor-theme.css', () => ({}))
vi.mock('@byline/ui/react', () => ({
  HelpText: () => null,
  Label: () => null,
}))

import { ApplyValuePlugin } from './apply-value-plugin'
import { APPLY_VALUE_TAG } from './constants'
import { hashSerializedState } from './utils/hashSerializedState'

// Enable React act warnings suppression for this environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// Mock the Lexical composer context to avoid spinning up a real editor.
//
// `_nodes` is required because ApplyValuePlugin normalizes the incoming
// value against the editor's registered node types before applying it.
// A stub with only the core types means nothing in these fixtures needs
// converting, so the plugin's apply behaviour is what is under test here
// rather than normalization (covered in `normalize/`).
const mockEditor = {
  update: (fn: () => void) => fn(),
  parseEditorState: vi.fn((val) => val),
  setEditorState: vi.fn(),
  _nodes: new Map<string, unknown>([
    ['root', {}],
    ['paragraph', {}],
    ['text', {}],
  ]),
}

vi.mock('@lexical/react/LexicalComposerContext', () => {
  return {
    useLexicalComposerContext: () => [mockEditor],
  }
})

describe('ApplyValuePlugin', () => {
  beforeEach(() => {
    mockEditor.parseEditorState.mockClear()
    mockEditor.setEditorState.mockClear()
  })

  const stateA: SerializedEditorState = {
    root: {
      children: [],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    } as SerializedRootNode,
  }

  const stateB: SerializedEditorState = {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: 'Hello world',
              type: 'text',
              version: 1,
            } as SerializedTextNode,
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
        } as SerializedElementNode,
      ],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    } as SerializedRootNode,
  }

  it('applies incoming value once and ignores identical hashes', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const lastEmitted = { current: undefined as string | undefined }
    const normalizedIncoming = { current: undefined as string | undefined }
    const hasNormalizedBaseline = { current: false }

    const hashA = hashSerializedState(stateA)

    await act(async () => {
      root.render(
        <ApplyValuePlugin
          value={stateA}
          incomingHash={hashA}
          lastEmittedHashRef={lastEmitted}
          normalizedIncomingHashRef={normalizedIncoming}
          hasNormalizedBaselineRef={hasNormalizedBaseline}
        />
      )
    })

    expect(mockEditor.setEditorState).toHaveBeenCalledTimes(1)
    // The APPLY_VALUE_TAG argument is not incidental: it is what stops
    // OnChangePlugin treating an applied value as a user edit, so assert
    // it rather than the state alone.
    expect(mockEditor.setEditorState).toHaveBeenLastCalledWith(stateA, { tag: APPLY_VALUE_TAG })

    // Re-render with same value -> no new apply
    await act(async () => {
      root.render(
        <ApplyValuePlugin
          value={stateA}
          incomingHash={hashA}
          lastEmittedHashRef={lastEmitted}
          normalizedIncomingHashRef={normalizedIncoming}
          hasNormalizedBaselineRef={hasNormalizedBaseline}
        />
      )
    })
    expect(mockEditor.setEditorState).toHaveBeenCalledTimes(1)

    // New value -> apply again
    const hashB = hashSerializedState(stateB)
    await act(async () => {
      root.render(
        <ApplyValuePlugin
          value={stateB}
          incomingHash={hashB}
          lastEmittedHashRef={lastEmitted}
          normalizedIncomingHashRef={normalizedIncoming}
          hasNormalizedBaselineRef={hasNormalizedBaseline}
        />
      )
    })
    expect(mockEditor.setEditorState).toHaveBeenCalledTimes(2)
    expect(mockEditor.setEditorState).toHaveBeenLastCalledWith(stateB, { tag: APPLY_VALUE_TAG })

    await act(async () => {
      root.unmount()
    })
  })

  it('skips apply when incoming hash matches last emitted (echo prevention)', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const lastEmitted = { current: hashSerializedState(stateA) }
    const normalizedIncoming = { current: undefined as string | undefined }
    const hasNormalizedBaseline = { current: false }
    const hashA = hashSerializedState(stateA)

    await act(async () => {
      root.render(
        <ApplyValuePlugin
          value={stateA}
          incomingHash={hashA}
          lastEmittedHashRef={lastEmitted}
          normalizedIncomingHashRef={normalizedIncoming}
          hasNormalizedBaselineRef={hasNormalizedBaseline}
        />
      )
    })

    expect(mockEditor.setEditorState).not.toHaveBeenCalled()
    await act(async () => {
      root.unmount()
    })
  })
})
