import { useMemo, useState } from 'react'

import { Button, CloseIcon, IconButton, Input, Modal } from '@infonomic/uikit/react'
import { type EmbedMatchResult, URL_MATCHER } from '@lexical/react/LexicalAutoEmbedPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

import type { AutoEmbedConfig } from './index'

const debounce = (callback: (text: string) => void, delay: number): ((text: string) => void) => {
  let timeoutId: number
  return (text: string) => {
    window.clearTimeout(timeoutId)
    timeoutId = window.setTimeout(() => {
      callback(text)
    }, delay)
  }
}

import './auto-embed-modal.css'

export function AutoEmbedModal({
  open,
  embedConfig,
  onClose,
}: {
  open: boolean
  embedConfig: AutoEmbedConfig
  onClose: () => void
}): React.JSX.Element | null {
  const [text, setText] = useState('')
  const [editor] = useLexicalComposerContext()
  const [embedResult, setEmbedResult] = useState<EmbedMatchResult | null>(null)

  const validateText = useMemo(
    () =>
      debounce((inputText: string) => {
        const urlMatch = URL_MATCHER.exec(inputText)
        if (embedConfig != null && inputText != null && urlMatch != null) {
          void Promise.resolve(embedConfig.parseUrl(inputText)).then((parseResult) => {
            setEmbedResult(parseResult)
          })
        } else if (embedResult == null) {
          setEmbedResult(null)
        }
      }, 200),
    [embedConfig, embedResult]
  )

  const handleOnSubmit = (): void => {
    if (embedResult != null) {
      embedConfig.insertNode(editor, embedResult)
      onClose()
    }
  }

  const handleOnClose = (): void => {
    setText('')
    setEmbedResult(null)
    onClose()
  }

  if (embedConfig == null) {
    return null
  }

  return (
    <Modal isOpen={open} onDismiss={handleOnClose} closeOnOverlayClick={false}>
      <Modal.Container className="auto-embed-modal-container">
        <Modal.Header className="auto-embed-modal-header">
          <h3>{embedConfig.contentName}</h3>
          <IconButton arial-label="Close" size="sm" onClick={handleOnClose}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content className="auto-embed-modal-content">
          <Input
            id="text"
            name="text"
            placeholder={embedConfig.exampleUrl}
            value={text}
            data-test-id={`${embedConfig.type}-embed-modal-url`}
            onChange={(e) => {
              const { value } = e.target
              setText(value)
              validateText(value)
            }}
          />
        </Modal.Content>
        <Modal.Actions className="auto-embed-modal-actions">
          <Button
            size="sm"
            intent="noeffect"
            onClick={handleOnClose}
            data-test-id={`${embedConfig.type}-embed-modal-cancel-btn`}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={embedResult == null}
            onClick={handleOnSubmit}
            data-test-id={`${embedConfig.type}-embed-modal-submit-btn`}
          >
            Embed
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
