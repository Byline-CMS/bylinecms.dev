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
vi.mock('@infonomic/uikit/react', () => ({
  HelpText: () => null,
  Label: () => null,
}))

import { ApplyValuePlugin } from './apply-value-plugin'
import { hashSerializedState } from './utils/hashSerializedState'

// Enable React act warnings suppression for this environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// Mock the Lexical composer context to avoid spinning up a real editor
const mockEditor = {
  update: (fn: () => void) => fn(),
  parseEditorState: vi.fn((val) => val),
  setEditorState: vi.fn(),
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
    expect(mockEditor.setEditorState).toHaveBeenLastCalledWith(stateA)

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
    expect(mockEditor.setEditorState).toHaveBeenLastCalledWith(stateB)

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
