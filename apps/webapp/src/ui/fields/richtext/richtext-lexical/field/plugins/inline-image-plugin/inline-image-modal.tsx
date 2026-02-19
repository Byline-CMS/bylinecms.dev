'use client'

/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useState } from 'react'

import { Button, CloseIcon, IconButton, Modal } from '@infonomic/uikit/react'

import { useEditorConfig } from '../../config/editor-config-context'
import { getInitialState, validateFields } from './fields'
import type { Position } from '../../nodes/inline-image-node'
import type { InlineImageData, InlineImageDrawerProps, InlineImageFormState } from './types'

import './inline-image-modal.css'

const _baseClass = 'inline-image-plugin--modal'

export const InlineImageModal: React.FC<InlineImageDrawerProps> = ({
  isOpen = false,
  drawerSlug,
  onSubmit,
  onClose,
  data: dataFromProps,
}) => {
  const { config } = useEditorConfig()
  // const { t } = useTranslation()
  const [synchronizedFormState, setSynchronizedFormState] = useState<
    InlineImageFormState | undefined
  >(undefined)

  const handleOnCancel = (): void => {
    setSynchronizedFormState(undefined)
    onClose()
  }

  async function _handleFormOnChange({
    formState,
  }: {
    formState: InlineImageFormState
  }): Promise<InlineImageFormState> {
    return new Promise((resolve, _reject) => {
      validateFields(formState)
      resolve(formState)
    })
  }

  const _handleFormOnSubmit = (
    fields: InlineImageFormState,
    data: Record<string, unknown>
  ): void => {
    const { valid } = validateFields(fields)
    if (valid === true) {
      if (onSubmit != null) {
        const submitData: InlineImageData = {
          id: data.image as string,
          altText: data.altText as string,
          position: data.position as Position,
          showCaption: data.showCaption as boolean,
        }
        onSubmit(submitData)
      }
      setSynchronizedFormState(undefined)
      onClose()
    }
  }

  useEffect(() => {
    if (synchronizedFormState == null && isOpen === true) {
      const formState = getInitialState(dataFromProps)
      setSynchronizedFormState(formState)
    }
  }, [synchronizedFormState, isOpen, dataFromProps])

  if (isOpen === false) {
    return null
  }

  return (
    <Modal isOpen={isOpen} onDismiss={handleOnCancel} closeOnOverlayClick={false}>
      <Modal.Container className="sm:max-w-[500px]">
        <Modal.Header className="flex items-center justify-between mb-4">
          <h3>Inline Image</h3>
          <IconButton arial-label="Close" size="sm" onClick={handleOnCancel}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content>
          <p>
            Modal content with some text here that should run a little longer. And longer here. And
            the current theme is.
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button size="sm" intent="noeffect" onClick={handleOnCancel} data-autofocus>
            Close
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
