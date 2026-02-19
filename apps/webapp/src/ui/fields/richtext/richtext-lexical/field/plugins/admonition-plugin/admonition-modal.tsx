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

import {
  Button,
  CloseIcon,
  IconButton,
  Input,
  Modal,
  RadioGroup,
  RadioGroupItem,
} from '@infonomic/uikit/react'

import { admonitionTypeOptions, getInitialState, validateFields } from './fields'
import type { AdmonitionType } from '../../nodes/admonition-node/types'
import type { AdmonitionDrawerProps, AdmonitionFormState } from './types'

import './admonition-modal.css'

function intent(type: AdmonitionType): 'info' | 'success' | 'warning' | 'danger' {
  switch (type) {
    case 'note':
      return 'info'
    case 'tip':
      return 'success'
    case 'warning':
      return 'warning'
    case 'danger':
      return 'danger'
  }
}

export function AdmonitionModal({
  open = false,
  onSubmit,
  onClose,
  data: dataFromProps,
}: AdmonitionDrawerProps): React.ReactNode {
  // const { t } = useTranslation()

  const [synchronizedFormState, setSynchronizedFormState] = useState<
    AdmonitionFormState | undefined
  >(undefined)

  const handleOnCancel = (): void => {
    if (onClose != null && typeof onClose === 'function') {
      onClose()
    }
  }

  async function handleOnChange({
    formState,
  }: {
    formState: AdmonitionFormState
  }): Promise<AdmonitionFormState> {
    return new Promise((resolve, _reject) => {
      validateFields(formState)
      resolve(formState)
    })
  }

  const handleOnSubmit = (): void => {
    const { valid } = validateFields(synchronizedFormState)
    if (valid === true && synchronizedFormState != null) {
      if (onSubmit != null) {
        onSubmit({
          admonitionType: synchronizedFormState.admonitionType.value as AdmonitionType,
          title: synchronizedFormState.title.value as string,
        })
        setSynchronizedFormState(undefined)
        if (onClose != null && typeof onClose === 'function') {
          onClose()
        }
      }
    }
  }

  useEffect(() => {
    if (synchronizedFormState == null && open === true) {
      const formState = getInitialState(dataFromProps)
      setSynchronizedFormState(formState)
    }
  }, [open, synchronizedFormState, dataFromProps])

  if (open === false) {
    return null
  }

  return (
    <Modal isOpen={open} onDismiss={handleOnCancel} closeOnOverlayClick={false}>
      <Modal.Container className="admonition-modal-container">
        <Modal.Header className="admonition-modal-header">
          <h3>Admonition</h3>
          <IconButton arial-label="Close" size="sm" onClick={handleOnCancel}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content className="admonition-modal-content">
          <Input
            inputWrapperClassName="admonition-modal-title"
            id="title"
            name="title"
            placeholder="Title"
            label="Title"
            onChange={(e) => {
              if (synchronizedFormState != null) {
                const newState = {
                  ...synchronizedFormState,
                  title: { ...synchronizedFormState.title, value: e.target.value },
                }
                handleOnChange({ formState: newState }).then((newFormState) => {
                  setSynchronizedFormState(newFormState)
                })
              }
            }}
            value={synchronizedFormState?.title.value ?? ''}
            data-test-id="admonition-modal-title-input"
          />
          <RadioGroup
            className="admonition-modal-radio-group"
            defaultValue="note"
            direction="row"
            id="admonitionType"
            name="admonitionType"
            aria-label="Admonition Type"
            value={synchronizedFormState?.admonitionType.value ?? 'note'}
            onValueChange={(value: AdmonitionType) => {
              if (synchronizedFormState != null) {
                const newState = {
                  ...synchronizedFormState,
                  admonitionType: {
                    ...synchronizedFormState.admonitionType,
                    value,
                  },
                }
                handleOnChange({ formState: newState }).then((newFormState) => {
                  setSynchronizedFormState(newFormState)
                })
              }
            }}
            data-test-id="admonition-modal-type-radio"
          >
            {admonitionTypeOptions.map((value) => (
              <RadioGroupItem
                intent={intent(value.value as AdmonitionType)}
                key={value.id}
                id={value.id}
                value={value.value}
                label={value.label}
              />
            ))}
          </RadioGroup>
        </Modal.Content>
        <Modal.Actions className="admonition-modal-actions">
          <Button
            size="sm"
            intent="noeffect"
            onClick={handleOnCancel}
            data-test-id="admonition-modal-submit-button"
            data-autofocus
          >
            Close
          </Button>
          <Button
            size="sm"
            intent="primary"
            onClick={handleOnSubmit}
            // disabled={isDisabled}
            data-test-id="admonition-modal-submit-button"
          >
            Submit
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
