'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  // CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
  type SerializedEditorState,
} from 'lexical'

import { useAiPublicConfig } from '../../config/ai-provider'
import { AiPluginBase, type AiPluginSubmitContext } from '../ai-plugin-base'
import { createEmptyEditorState } from './create-empty-editor-state'
import { importHtmlToSerializedEditorState } from './import-html'
import type { ExecuteInstruction, InstructionState } from '../../@types'

export const TOGGLE_AI_DRAWER_COMMAND = createCommand('TOGGLE_AI_DRAWER_COMMAND')

/**
 * Broadcasts the AI drawer's open/closed state so contributed UI (the
 * toolbar button) can show an active visual cue. Dispatched by the drawer
 * plugin whenever `open` changes — including closes triggered from the
 * drawer's own controls. Observers register a listener and return `false`.
 */
export const AI_DRAWER_STATE_COMMAND = createCommand<boolean>('AI_DRAWER_STATE_COMMAND')

const emptyInstructionState: InstructionState = {
  prompt: '',
  editor: null,
  errors: {},
  status: 'idle',
  lastRun: null,
}

export const AiPluginLexical = React.memo(function AiPlugin(): React.JSX.Element | undefined {
  const submitEditorRef = useRef<LexicalEditor | null>(null)
  const aiConfig = useAiPublicConfig()
  const [editor] = useLexicalComposerContext()
  const [activeEditor, setActiveEditor] = useState(editor)
  const [open, setOpen] = useState(false)

  const applyInstructionStateToEditor = useCallback(
    (
      nextState: InstructionState,
      setInstructionState: React.Dispatch<React.SetStateAction<InstructionState>>
    ) => {
      if (nextState?.status !== 'success') return
      const targetEditor = submitEditorRef.current ?? editor
      if (nextState.format === 'html' && nextState.html) {
        try {
          importHtmlToSerializedEditorState(nextState.html, targetEditor)
        } catch {
          setInstructionState((prev) => ({
            ...prev,
            status: 'failed',
            message: 'There was a problem parsing fallback HTML.',
            errors: {},
          }))
        }
        return
      }

      if (nextState.editor) {
        const nextEditorState = targetEditor.parseEditorState(
          nextState.editor as SerializedEditorState
        )
        // Must NOT be wrapped in editor.update — setEditorState defers its
        // commit when called inside an active update, leaving selection/node
        // references pointing into the pre-swap nodeMap (surfaces as stale
        // node-key errors from @lexical/table observers).
        targetEditor.setEditorState(nextEditorState)
      }
    },
    [editor]
  )

  const handleOnSubmit = useCallback(
    async (context: AiPluginSubmitContext) => {
      const {
        prompt,
        mode,
        provider,
        model,
        isPending,
        setIsPending,
        setInstructionState,
        abortControllerRef,
      } = context

      if (!prompt.trim()) return
      if (isPending) return

      // Cancel any previous in-flight request before starting a new one.
      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      activeEditor.focus()
      submitEditorRef.current = activeEditor
      setIsPending(true)
      setInstructionState((prev) => ({ ...prev, status: 'idle', errors: {}, message: undefined }))

      const editorJson = JSON.stringify(activeEditor.getEditorState().toJSON())

      try {
        const payload: ExecuteInstruction = {
          params: {
            prompt: prompt,
            mode,
            input: {
              type: 'structured',
              editorJson,
            },
            provider,
            model,
            output: {
              type: 'structured',
            },
          },
          options: {
            streaming: false,
          },
        }

        const fetchImpl = aiConfig.fetch ?? fetch
        const response = await fetchImpl(aiConfig.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(aiConfig.headers ?? {}),
          },
          signal: abortController.signal,
          body: JSON.stringify(payload),
        })

        if (response.ok === false) {
          console.error('AI Plugin request failed with status', response.status)
          setInstructionState({
            ...emptyInstructionState,
            status: 'failed',
            message: 'There was a problem submitting your instructions.',
            errors: {},
          })
        }
        const data = (await response.json()) as InstructionState
        // console.log('AI Plugin response data', data)
        setInstructionState(data)
        applyInstructionStateToEditor(data, setInstructionState)
      } catch (error) {
        const err = error as any
        if (err?.name === 'AbortError') {
          setInstructionState((prev) => ({
            ...prev,
            status: 'idle',
            message: 'Cancelled.',
            errors: {},
          }))
        } else {
          setInstructionState({
            ...emptyInstructionState,
            status: 'failed',
            message: 'There was a problem submitting your instructions.',
            errors: {},
          })
        }
      } finally {
        setIsPending(false)
        abortControllerRef.current = null
      }
    },
    [aiConfig, activeEditor, applyInstructionStateToEditor]
  )

  const handleOnSubmitStreaming = useCallback(
    async (context: AiPluginSubmitContext) => {
      const {
        prompt,
        mode,
        provider,
        model,
        isPending,
        setIsPending,
        setInstructionState,
        abortControllerRef,
        appendStreamPreview,
        resetStreamPreview,
      } = context

      if (!prompt.trim()) return
      if (isPending) return

      // Cancel any previous in-flight request before starting a new one.
      abortControllerRef.current?.abort()
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      activeEditor.focus()
      submitEditorRef.current = activeEditor
      setIsPending(true)
      resetStreamPreview()
      setInstructionState((prev) => ({ ...prev, status: 'idle', errors: {}, message: undefined }))

      const editorJson = JSON.stringify(activeEditor.getEditorState().toJSON())

      try {
        const payload: ExecuteInstruction = {
          params: {
            prompt: prompt,
            mode,
            input: {
              type: 'structured',
              editorJson,
            },
            provider,
            model,
            output: {
              type: 'structured',
            },
          },
          options: {
            streaming: true,
          },
        }

        const fetchImpl = aiConfig.fetch ?? fetch
        const response = await fetchImpl(aiConfig.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(aiConfig.headers ?? {}),
          },
          signal: abortController.signal,
          body: JSON.stringify(payload),
        })

        if (response.ok === false) {
          console.error('AI Plugin streaming request failed with status', response.status)
          setInstructionState({
            ...emptyInstructionState,
            status: 'failed',
            message: 'There was a problem submitting your instructions.',
            errors: {},
          })
        }

        if (response.body == null) {
          console.log('Streaming request has no body - falling back to non-streaming handling.')
          const data = (await response.json()) as InstructionState
          setInstructionState(data)
          applyInstructionStateToEditor(data, setInstructionState)
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finalState: InstructionState | null = null

        while (true) {
          const { value, done } = await reader.read()
          // console.log('Streaming response read', { value, done })
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          // console.log('Streaming response decoded lines', { lines })

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const payload = JSON.parse(trimmed) as {
                type?: string
                text?: string
                state?: InstructionState
              }

              // console.log('Streaming response payload per line', payload)

              if (payload.type === 'delta' && typeof payload.text === 'string') {
                appendStreamPreview(payload.text)
              }

              if (payload.type === 'final' && payload.state) {
                finalState = payload.state
              }
            } catch {
              // ignore malformed chunks
            }
          }
        }

        if (finalState) {
          setInstructionState(finalState)
          applyInstructionStateToEditor(finalState, setInstructionState)
        } else {
          setInstructionState({
            ...emptyInstructionState,
            status: 'failed',
            message: 'There was a problem submitting your instructions.',
            errors: {},
          })
        }
      } catch (error) {
        const err = error as any
        if (err?.name === 'AbortError') {
          setInstructionState((prev) => ({
            ...prev,
            status: 'idle',
            message: 'Cancelled.',
            errors: {},
          }))
        } else {
          setInstructionState({
            ...emptyInstructionState,
            status: 'failed',
            message: 'There was a problem submitting your instructions.',
            errors: {},
          })
        }
      } finally {
        setIsPending(false)
        resetStreamPreview()
        abortControllerRef.current = null
      }
    },
    [aiConfig, activeEditor, applyInstructionStateToEditor]
  )

  function handleOnDebug(): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(activeEditor.getEditorState()))
  }

  // function handleOnFullReset(): void {
  //   activeEditor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined)
  //   activeEditor.focus()
  // }

  const handleOnClear = () => {
    const emptyState = activeEditor.parseEditorState(createEmptyEditorState())
    activeEditor.setEditorState(emptyState)
    activeEditor.focus()
  }

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditor) => {
        setActiveEditor(newEditor)
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<null>(
        TOGGLE_AI_DRAWER_COMMAND,
        () => {
          setOpen((prevOpen) => !prevOpen)
          return true
        },
        COMMAND_PRIORITY_NORMAL
      )
    )
  }, [editor])

  // Broadcast open/closed state so the contributed toolbar button can
  // reflect it. Fires on mount (false) and on every change, so the cue
  // also tracks closes triggered from the drawer's own controls.
  useEffect(() => {
    editor.dispatchCommand(AI_DRAWER_STATE_COMMAND, open)
  }, [editor, open])

  const helpContent = (
    <>
      <p style={{ margin: '0.5rem 0', fontSize: '16px' }}>
        Byline's AI editing feature can currently be used to generate new content as well as
        translate, summarize, rephrase, check spelling, grammar and clarity in existing text.
      </p>
      <p style={{ margin: '0.5rem 0', fontSize: '16px' }}>Here are a few example prompts:</p>
      <ul style={{ margin: '0.5rem 0', fontSize: '16px' }}>
        <li>Check for spelling, grammar and clarity.</li>
        <li>Translate into Thai (English, French, Spanish, Vietnamese, Laos, Khmer etc.).</li>
        <li>Rephrase to make this more engaging.</li>
        <li>Write a haiku poem about the wind and trees.</li>
      </ul>
      <p style={{ margin: '0.5rem 0', fontSize: '16px' }}>
        <strong style={{ color: 'var(--primary-500)' }}>Important:</strong> The AI operates in three
        modes:
      </p>
      <ol style={{ margin: '0.5rem 0', fontSize: '16px' }}>
        <li>
          <strong>New:</strong> The AI will generate new content based solely on the prompt.
        </li>
        <li>
          <strong>With Context:</strong> The AI will generate new content based on the prompt and
          the existing content.
        </li>
        <li>
          <strong>Modify:</strong> The AI will suggest modifications to the existing content based
          on the prompt - preserving the original structure. Use this mode for translations,
          grammar, clarity, and tone edits.
        </li>
      </ol>
      <p className="ai-plugin__disclaimer--modal">
        Warning: AI-generated content may be inaccurate, incomplete, or misleading. Please use
        caution and verify information from reliable sources.
      </p>
    </>
  )

  return (
    <AiPluginBase
      helpTitle="AI Help"
      helpContent={helpContent}
      onSubmit={handleOnSubmit}
      onSubmitStreaming={handleOnSubmitStreaming}
      onClear={handleOnClear}
      onDebug={handleOnDebug}
      open={open}
      onOpenChange={setOpen}
    />
  )
})
