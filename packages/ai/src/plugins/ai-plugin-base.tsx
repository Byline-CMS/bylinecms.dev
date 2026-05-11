'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import type { InstructionState, Provider } from '@byline/ai'
import { getDefaultModel, isProvider, PROVIDER_MODELS } from '@byline/ai'
import {
  Button,
  Checkbox,
  CloseIcon,
  IconButton,
  InfoIcon,
  LoaderEllipsis,
  Modal,
  ScrollArea,
  Select,
  type SelectValue,
  // Checkbox,
  SettingsSlidersIcon,
  StopIcon,
  TextArea,
  useModal,
} from '@byline/ui/react'

import { loadChatConfiguration, saveChatConfiguration } from './storage'
import { appendRollingPreviewText } from './streaming-preview'

import './ai-plugin.css'

type EditorChatState = {
  mode: 'new' | 'new_with_context' | 'patch'
  provider: Provider
  model: string
}

export type AiPluginSubmitContext = {
  prompt: string
  mode: 'new' | 'new_with_context' | 'patch'
  provider: Provider
  model: string
  isPending: boolean
  setIsPending: React.Dispatch<React.SetStateAction<boolean>>
  instructionState: InstructionState
  setInstructionState: React.Dispatch<React.SetStateAction<InstructionState>>
  abortControllerRef: React.RefObject<AbortController | null>
  appendStreamPreview: (chunk: string) => void
  resetStreamPreview: () => void
  useStreaming: boolean
  setUseStreaming: React.Dispatch<React.SetStateAction<boolean>>
}

export type AiPluginBaseProps = {
  onSubmit: (context: AiPluginSubmitContext) => Promise<void> | void
  onSubmitStreaming?: (context: AiPluginSubmitContext) => Promise<void> | void
  onCancel?: () => void
  onClear?: () => void
  onDebug?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  helpTitle?: React.ReactNode
  helpContent?: React.ReactNode
}

const initialInstructionState: InstructionState = {
  prompt: '',
  editor: null,
  errors: {},
  status: 'idle',
  lastRun: null,
}

const initialEditorChatState: EditorChatState = {
  mode: 'new',
  provider: 'openai',
  model: getDefaultModel('openai'),
}

const formatLastRun = (ms: number): string => {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const milliseconds = safe % 1_000

  return `${minutes}:${String(seconds).padStart(2, '0')}:${String(milliseconds).padStart(3, '0')}`
}

const STREAM_PREVIEW_MAX_CHARS = 200
const STREAM_PREVIEW_UPDATE_INTERVAL_MS = 150

export const AiPluginBase = React.memo(function AiPluginBase(
  props: AiPluginBaseProps
): React.JSX.Element | undefined {
  const { onDismiss, isOpen, setIsOpen } = useModal()
  const [state, setState] = useState<EditorChatState>(initialEditorChatState)
  const [instructionState, setInstructionState] =
    useState<InstructionState>(initialInstructionState)
  const [isPending, setIsPending] = useState(false)
  const [useStreaming, setUseStreaming] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [streamPreviewText, setStreamPreviewText] = useState('')
  const streamPreviewAccumulatorRef = useRef('')
  const streamPreviewLastFlushMsRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const hydratedRef = useRef(false)
  const skipPersistOnceRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const open = props.open ?? props.defaultOpen ?? false

  const resetStreamPreview = () => {
    streamPreviewAccumulatorRef.current = ''
    streamPreviewLastFlushMsRef.current = 0
    setStreamPreviewText('')
  }

  const appendStreamPreview = (chunk: string) => {
    streamPreviewAccumulatorRef.current = appendRollingPreviewText(
      streamPreviewAccumulatorRef.current,
      chunk,
      { maxChars: STREAM_PREVIEW_MAX_CHARS }
    )

    const now = Date.now()
    if (now - streamPreviewLastFlushMsRef.current < STREAM_PREVIEW_UPDATE_INTERVAL_MS) return
    streamPreviewLastFlushMsRef.current = now
    setStreamPreviewText(streamPreviewAccumulatorRef.current)
  }

  const handleOnPromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value)
  }

  const handleOnModeChange = (value: unknown, _eventDetails: unknown) => {
    if (value !== 'new' && value !== 'new_with_context' && value !== 'patch') return
    setState((prev) => ({ ...prev, mode: value }))
  }

  const handleOnProviderChange = (value: unknown, _eventDetails: unknown) => {
    if (typeof value !== 'string') return
    if (!isProvider(value)) return
    setState((prev) => ({
      ...prev,
      provider: value,
      model: getDefaultModel(value),
    }))
  }

  const handleOnModelChange = (value: unknown, _eventDetails: unknown) => {
    if (typeof value !== 'string' || !value) return
    const modelsForProvider = PROVIDER_MODELS[state.provider] ?? []
    if (!modelsForProvider.includes(value)) return
    setState((prev) => ({ ...prev, model: value }))
  }

  const buildSubmitContext = (): AiPluginSubmitContext => ({
    prompt,
    mode: state.mode,
    provider: state.provider,
    model: state.model,
    isPending,
    setIsPending,
    instructionState,
    setInstructionState,
    abortControllerRef,
    appendStreamPreview,
    resetStreamPreview,
    useStreaming,
    setUseStreaming,
  })

  const handleOnSubmit = () => {
    if (!prompt.trim()) return
    if (isPending) return
    void props.onSubmit(buildSubmitContext())
  }

  const handleOnSubmitStreaming = () => {
    if (!prompt.trim()) return
    if (isPending) return
    const handler = props.onSubmitStreaming ?? props.onSubmit
    if (!handler) return
    void handler(buildSubmitContext())
  }

  const handleOnKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (useStreaming) {
        handleOnSubmitStreaming()
        return
      }
      handleOnSubmit()
    }
  }

  const handleOnCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsPending(false)
    resetStreamPreview()
    setInstructionState((prev) => ({ ...prev, status: 'idle', message: 'Cancelled.', errors: {} }))
    props.onCancel?.()
  }

  useEffect(() => {
    const config = loadChatConfiguration()
    if (config && PROVIDER_MODELS[config.provider]) {
      const modelsForProvider = PROVIDER_MODELS[config.provider] ?? []
      const model = modelsForProvider.includes(config.model)
        ? config.model
        : getDefaultModel(config.provider)

      setState({
        mode: config.mode,
        provider: config.provider,
        model,
      })
      skipPersistOnceRef.current = true
    }
    hydratedRef.current = true
  }, [])

  useEffect(() => {
    if (!hydratedRef.current) return
    if (skipPersistOnceRef.current) {
      skipPersistOnceRef.current = false
      return
    }
    saveChatConfiguration({
      mode: state.mode,
      provider: state.provider,
      model: state.model,
    })
  }, [state.mode, state.provider, state.model])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  return (
    <div className={`ai-plugin__drawer ${open ? 'ai-plugin__drawer--visible' : ''}`}>
      <div
        className={`ai-plugin__stream-preview ${isPending && useStreaming ? 'ai-plugin__stream-preview--visible' : ''}`}
        aria-live="polite"
        aria-busy="true"
      >
        <div className="ai-plugin__stream-preview__label">Streaming preview</div>
        <div className="ai-plugin__stream-preview__content">
          {streamPreviewText || 'Receiving…'}
        </div>
      </div>

      <TextArea
        className="ai-plugin__prompt"
        label="Prompt"
        id="prompt"
        name="prompt"
        rows={5}
        value={prompt}
        onChange={handleOnPromptChange}
        onKeyDown={handleOnKeyDown}
        disabled={isPending === true}
        spellCheck={true}
        helpText={`Enter your prompt (Cmd/Ctrl + Enter to submit). Last run: ${
          instructionState?.lastRun == null ? 'never' : formatLastRun(instructionState.lastRun)
        }`}
      />
      <div className="ai-plugin__actions">
        <IconButton
          aria-label="Help"
          size="sm"
          variant="text"
          onClick={() => {
            setSettingsOpen(!settingsOpen)
          }}
        >
          <SettingsSlidersIcon />
        </IconButton>

        <Select
          name="mode"
          size="sm"
          disabled={isPending === true}
          value={state.mode}
          onValueChange={handleOnModeChange}
          items={[
            { label: 'New', value: 'new' },
            { label: 'With Context', value: 'new_with_context' },
            { label: 'Modify', value: 'patch' },
          ]}
        />

        <Button
          fullWidth={false}
          type="button"
          intent="success"
          size="sm"
          onClick={useStreaming ? handleOnSubmitStreaming : handleOnSubmit}
          disabled={!prompt.trim() || isPending === true}
        >
          {isPending === true ? <LoaderEllipsis size={30} /> : <span>Submit</span>}
        </Button>

        <Button
          className="py-0 px-4"
          size="sm"
          title="Stop"
          aria-label="Stop"
          onClick={handleOnCancel}
          disabled={isPending === false}
          type="button"
        >
          <StopIcon width="22px" height="22px" />
        </Button>
        <Button
          fullWidth={false}
          type="button"
          size="sm"
          onClick={props.onClear}
          disabled={isPending === true}
        >
          Clear
        </Button>
      </div>
      {instructionState?.status === 'success' && isPending === false && (
        <p className="ai-plugin__messages--success-message">{instructionState.message}</p>
      )}

      {instructionState?.status === 'failed' && isPending === false && (
        <p className="ai-plugin__messages--error-message">{instructionState.message}</p>
      )}
      <div className={`ai-plugin__settings ${settingsOpen ? 'ai-plugin__settings--visible' : ''}`}>
        <Select
          name="provider"
          size="sm"
          disabled={isPending === true || settingsOpen === false}
          value={state.provider}
          onValueChange={handleOnProviderChange}
          variant="outlined"
          items={[
            { label: 'OpenAI', value: 'openai' },
            { label: 'Google', value: 'google' },
            { label: 'Anthropic', value: 'anthropic' },
          ]}
        />

        <Select
          name="model"
          disabled={isPending === true || settingsOpen === false}
          size="sm"
          value={state.model}
          onValueChange={handleOnModelChange}
          variant="outlined"
          items={(PROVIDER_MODELS[state.provider] ?? []).map(
            (m): SelectValue => ({ label: m, value: m })
          )}
        />

        <div className="mr-2">
          <Checkbox
            name="streaming"
            size="sm"
            id="streaming"
            disabled={isPending === true || settingsOpen === false}
            checked={useStreaming}
            onCheckedChange={(checked, _eventDetails) => {
              setUseStreaming(checked === true)
            }}
            label="Streaming"
          />
        </div>
        <Button size="sm" variant="text" disabled={isPending === true} onClick={props.onDebug}>
          Debug
        </Button>
      </div>
      <div className="ai-plugin__footer">
        <div className="ai_plugin_footer_text">
          <p className="ai_plugin__mode-description">
            {state.mode === 'new' &&
              'The AI will generate new content based solely on the prompt - replacing existing content.'}
            {state.mode === 'new_with_context' &&
              'The AI will generate new content based on the prompt and the existing content - replacing the existing content.'}
            {state.mode === 'patch' &&
              'The AI will modify the existing content based on the prompt - preserving the original structure. Use this mode for translations, grammar, clarity, and tone.'}
          </p>
          <p className="ai-plugin__disclaimer">
            AI-generated content may be inaccurate, incomplete, or misleading. Please use caution
            and verify information from reliable sources.
          </p>
        </div>
        <span className="ai-plugin__help">
          <IconButton
            aria-label="Help"
            size="sm"
            variant="text"
            onClick={() => {
              setIsOpen(true)
            }}
          >
            <InfoIcon width="22px" height="22px" svgClassName="ai-plugin__help_icon" />
          </IconButton>
        </span>
      </div>
      <Modal isOpen={isOpen} onDismiss={onDismiss} closeOnOverlayClick={true}>
        <Modal.Container style={{ maxWidth: '600px', borderRadius: '4px' }}>
          <Modal.Header style={{ marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '1.65rem' }}>{props.helpTitle ?? 'AI Help'}</h2>
            <IconButton
              arial-label="Close"
              size="xs"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content style={{ padding: '18px' }}>
            <ScrollArea
              style={{ height: '400px', paddingRight: '18px', fontSize: '14px' }}
              className="prose"
            >
              {props.helpContent ?? (
                <p style={{ margin: '0.5rem 0', fontSize: '16px' }}>No help content provided.</p>
              )}
            </ScrollArea>
          </Modal.Content>
          <Modal.Actions>
            <Button
              size="sm"
              style={{ minWidth: '80px' }}
              intent="primary"
              onClick={() => {
                setIsOpen(false)
              }}
              data-autofocus
            >
              Close
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </div>
  )
})
