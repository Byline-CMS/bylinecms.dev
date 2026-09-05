import { act } from 'react'

import {
  ERR_DOCUMENT_HOOK_COMMITTED,
  ERR_DOCUMENT_STALE,
  ERR_LOCK_CONFLICT,
  ERR_VALIDATION,
} from '@byline/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDocumentMutationState } from './document-mutation-state.js'

type Observation = { id: string; versionId: string; revision?: number; fields: { title: string } }
let state: ReturnType<typeof useDocumentMutationState<Observation>>
let root: Root
let container: HTMLDivElement
function Probe({ observation }: { observation: Observation | null }) {
  state = useDocumentMutationState(observation)
  return null
}
const original: Observation = {
  id: 'doc',
  versionId: 'v1',
  revision: 7,
  fields: { title: 'Opened' },
}
const render = (observation: Observation | null) =>
  act(() => root.render(<Probe observation={observation} />))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  root = createRoot(container)
  render(original)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})
const stale = ERR_DOCUMENT_STALE({
  message: 'Test failure',
  details: {
    reason: 'revision_mismatch',
    documentId: 'doc',
    expectedRevision: 7,
    currentRevision: 8,
  },
})

describe('editor observation ownership', () => {
  it('does not attach a background metadata revision to the opened fields', () => {
    render({ ...original, revision: 8 })
    expect(state.document).toBe(original)
    expect(state.expectedRevision()).toBe(7)
  })
  it('adopts its own structural receipt without discarding fields and surfaces schedule suspension', () => {
    act(() =>
      state.adopt({ documentId: 'doc', revision: 8, scheduledPublicationsNeedReconfirmation: true })
    )
    expect(state.document).toBe(original)
    expect(state.expectedRevision()).toBe(8)
    expect(state.scheduleNotice).toBe(true)
    const refreshed = { ...original, revision: 8 }
    render(refreshed)
    expect(state.document).toBe(refreshed)
  })
  it.each([
    ['stale', stale],
    [
      'reload',
      ERR_VALIDATION({ message: 'Test failure', details: { reason: 'missing_document_revision' } }),
    ],
    [
      'lock',
      ERR_LOCK_CONFLICT({
        message: 'Test failure',
        details: { reason: 'lock_conflict', rolledBack: true, retryable: true },
      }),
    ],
    ['unavailable', { code: 'ERR_NOT_FOUND' }],
  ])(
    'blocks every later call after %s without adopting fresh data or a late receipt',
    (issue, error) => {
      act(() => {
        expect(state.report(error)).toBe('blocked')
      })
      render({ ...original, revision: 9 })
      act(() => state.adopt({ documentId: 'doc', revision: 8 }))
      expect(state.issue).toBe(issue)
      expect(state.blocked).toBe(true)
      expect(state.document).toBe(original)
      expect(state.revision).toBe(7)
      expect(() => state.assertWritable()).toThrow()
      expect(() => state.expectedRevision()).toThrow()
    }
  )
  it('keeps a rejected empty singleton empty until a new editor session', () => {
    act(() => root.unmount())
    root = createRoot(container)
    render(null)
    const error = ERR_DOCUMENT_STALE({
      message: 'Test failure',
      details: {
        reason: 'singleton_slot_changed',
        singletonPath: 'settings',
        expectedState: 'empty',
        currentState: 'document',
      },
    })
    act(() => {
      state.report(error)
    })
    render(original)
    expect(state.document).toBeNull()
    expect(state.blocked).toBe(true)
  })
  it('keeps committed hook failures distinct and advances only to the committed revision', () => {
    const error = ERR_DOCUMENT_HOOK_COMMITTED({
      message: 'Test failure',
      details: {
        phase: 'afterUpdate',
        documentId: 'doc',
        documentVersionId: 'v2',
        revision: 8,
        sideEffectCode: 'ERR_UNHANDLED',
      },
    })
    act(() => {
      expect(state.report(error)).toBe('committed')
    })
    expect(state.issue).toBe('committed')
    expect(state.blocked).toBe(false)
    expect(state.expectedRevision()).toBe(8)
  })
  it('does not classify arbitrary conflicts or uncertain driver failures as safe rollback', () => {
    for (const error of [
      { code: 'ERR_CONFLICT' },
      new Error('deadlock SQL secret'),
      { code: 'ECONNRESET' },
    ]) {
      expect(state.report(error)).toBeNull()
    }
    expect(state.blocked).toBe(false)
  })
})
