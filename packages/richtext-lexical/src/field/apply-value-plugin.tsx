'use client'

import type * as React from 'react'
import { useEffect, useRef } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { SerializedEditorState } from 'lexical'

import { APPLY_VALUE_TAG } from './constants'
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
  const lastAppliedHashRef = useRef<string | undefined>(undefined)

  const cancelWaiterRef = useRef<() => void>(undefined)

  useEffect(() => {
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

    const nextState = editor.parseEditorState(value)

    editor.update(
      () => {
        editor.setEditorState(nextState)
      },
      { tag: APPLY_VALUE_TAG }
    )
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
  ])

  return null
}
