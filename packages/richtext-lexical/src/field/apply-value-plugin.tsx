'use client'

import type * as React from 'react'
import { useLayoutEffect, useRef } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { SerializedEditorState } from 'lexical'

import { registeredNodeTypes } from './capabilities/registered-node-types'
import { APPLY_VALUE_TAG } from './constants'
import { useNormalizationStatus } from './normalize/normalization-status'
import { normalizeValue } from './normalize/normalize-value'
import { hashSerializedState } from './utils/hashSerializedState'

export function ApplyValuePlugin({
  value,
  incomingHash,
  lastEmittedHashRef,
  normalizedIncomingHashRef,
  hasNormalizedBaselineRef,
}: {
  value?: SerializedEditorState | null
  incomingHash?: string
  lastEmittedHashRef: React.RefObject<string | undefined>
  normalizedIncomingHashRef: React.RefObject<string | undefined>
  hasNormalizedBaselineRef: React.RefObject<boolean>
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const { setStatus } = useNormalizationStatus()
  const lastAppliedHashRef = useRef<string | undefined>(undefined)

  const cancelWaiterRef = useRef<() => void>(undefined)

  // A layout effect, not a passive one: this is the ONLY path by which a
  // stored value reaches the editor — the root extension deliberately
  // carries no `$initialEditorState` — so applying before paint avoids
  // showing an empty field first.
  useLayoutEffect(() => {
    if (value == null) return

    const nextRawHash = incomingHash

    if (nextRawHash === lastEmittedHashRef.current) {
      if (hasNormalizedBaselineRef.current !== true) {
        hasNormalizedBaselineRef.current = true
        if (cancelWaiterRef.current) {
          cancelWaiterRef.current()
          cancelWaiterRef.current = undefined
        }
      }
      return
    }

    if (nextRawHash === lastAppliedHashRef.current) {
      // If the incoming value matches what we last applied, we assume the previous
      // waiter (if any) is still running or has completed.
      // We do NOT want to cancel it just because of a re-render.
      return
    }

    // We are about to apply a new external value.
    // Cancel any pending waiter for the previous value.
    if (cancelWaiterRef.current) {
      cancelWaiterRef.current()
      cancelWaiterRef.current = undefined
    }

    hasNormalizedBaselineRef.current = false

    // Adapt the stored value to what this editor actually accepts.
    // Lexical throws on an unregistered type and loses the text, so a
    // field whose configuration narrowed since the document was written
    // would otherwise open blank and erroring.
    const normalized = normalizeValue(value, registeredNodeTypes(editor))

    if (normalized.status === 'refused') {
      // No safe conversion exists — an image's media relation and its
      // nested-editor caption survive no structural rewrite. Leave the
      // editor as it stands and let the surface render read-only rather
      // than silently discarding what the document holds.
      setStatus({ kind: 'refused', unsupportedTypes: normalized.unsupportedTypes })

      // Forget the last applied value. A refusal applies nothing, so the
      // memo below ("this hash is already applied, skip") would otherwise
      // swallow a return to that same value — the notice would stay up
      // and the editor would never be restored. Toggling between a
      // refused value and a valid one is the first thing a reader does.
      lastAppliedHashRef.current = undefined

      // Nothing further will arrive to establish a baseline, and the
      // parent suppresses change events until one exists.
      hasNormalizedBaselineRef.current = true
      return
    }

    setStatus(
      normalized.status === 'adapted'
        ? { kind: 'adapted', convertedTypes: normalized.convertedTypes }
        : { kind: 'ok' }
    )

    const nextState = editor.parseEditorState(
      normalized.status === 'adapted' ? JSON.stringify(normalized.value) : value
    )

    // Must NOT be wrapped in editor.update — setEditorState defers its commit
    // when called inside an active update, leaving selection/node references
    // pointing into the pre-swap nodeMap. Surfaces as @lexical/table observer
    // errors ("Expected node with key N to exist") on the very next selection
    // change. setEditorState applies the tag itself.
    editor.setEditorState(nextState, { tag: APPLY_VALUE_TAG })
    // Keyed to the ORIGINAL value's hash, never the adapted one, so an
    // adapted document does not read as a change on every mount.
    lastAppliedHashRef.current = nextRawHash

    let cancelled = false
    cancelWaiterRef.current = () => {
      cancelled = true
    }

    // Capture what Lexical *actually* settled on after applying + running immediate transforms.
    // Two rAFs helps ensure we’re past the commit + plugin side-effects.
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return
          const settled = editor.getEditorState().toJSON() as SerializedEditorState
          normalizedIncomingHashRef.current = hashSerializedState(settled)
          hasNormalizedBaselineRef.current = true
        })
      })
    })

    // Important: Do NOT cancel the waiter in the useEffect cleanup.
    // If the component re-renders with the same value (hash), we want the existing waiter to continue.
    // If the component unmounts, we also want the waiter to finish setting the baseline for the parent.
    // We only cancel if we are about to apply a DIFFERENT value (handled above).
  }, [
    editor,
    value,
    incomingHash,
    lastEmittedHashRef,
    normalizedIncomingHashRef,
    hasNormalizedBaselineRef,
    setStatus,
  ])

  return null
}
