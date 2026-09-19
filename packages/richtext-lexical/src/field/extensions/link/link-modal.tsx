'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { useMemo, useState } from 'react'

import type { MultiCollectionDefinition } from '@byline/core'
import { getAdminConfig, isSingleton } from '@byline/core'
import { Button, CloseIcon, IconButton, Input, Modal } from '@byline/ui/react'

import { useModalFormState } from '../../shared/useModalFormState'
import { LinkTargetFields } from './link-target-fields'
import {
  fromLinkAttributes,
  type LinkTargetState,
  toLinkAttributes,
  validateLinkTarget,
} from './link-target-state'
import type { LinkAttributes } from '.'
import type { LinkModalProps } from './link-modal-types'

interface FormState {
  text: string
  target: LinkTargetState
}

/**
 * A link node exists because it points somewhere, so "no target" is not a
 * valid outcome here — unlike the inline-image modal, where the link is
 * optional. Everything else about the target sub-form is shared.
 */
const LINK_TARGET_OPTIONS = { allowNone: false } as const

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen = false,
  onSubmit,
  onClose,
  data: dataFromProps,
}) => {
  const linkable = useMemo<MultiCollectionDefinition[]>(
    () =>
      getAdminConfig().collections.filter(
        (collection): collection is MultiCollectionDefinition =>
          !isSingleton(collection) && collection.linksInEditor === true
      ),
    []
  )

  const [urlError, setUrlError] = useState<string | null>(null)

  const [state, setState] = useModalFormState<FormState>(
    isOpen,
    () => ({
      text: dataFromProps?.text ?? '',
      target: fromLinkAttributes(dataFromProps?.fields, linkable, LINK_TARGET_OPTIONS),
    }),
    () => setUrlError(null)
  )

  const handleSave = () => {
    const problem = validateLinkTarget(state.target)
    if (problem != null) {
      setUrlError(problem)
      return
    }
    const fields = toLinkAttributes(state.target)
    if (fields == null) {
      setUrlError('Pick a target document')
      return
    }

    onSubmit({
      text: state.text.length > 0 ? state.text : null,
      fields: fields as LinkAttributes,
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onDismiss={onClose} closeOnOverlayClick={false}>
      <Modal.Container style={{ maxWidth: '480px', width: '100%' }}>
        <Modal.Header className="flex items-center justify-between pt-4 mb-4">
          <h3 className="m-0 text-xl">Edit link</h3>
          <IconButton aria-label="Close" size="xs" onClick={onClose}>
            <CloseIcon width="15px" height="15px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content>
          <div className="flex flex-col gap-4">
            <Input
              id="link-text"
              className="mb-2"
              name="text"
              label="Link text"
              placeholder="Visible link text"
              value={state.text}
              onChange={(e) => setState((s) => ({ ...s, text: e.target.value }))}
            />

            <LinkTargetFields
              idPrefix="link"
              state={state.target}
              onChange={(target) => {
                setUrlError(null)
                setState((s) => ({ ...s, target }))
              }}
              linkable={linkable}
              allowNone={false}
              error={urlError}
              legend="Link type"
            />
          </div>
        </Modal.Content>
        <Modal.Actions className="flex gap-3">
          <Button
            size="sm"
            intent="noeffect"
            type="button"
            onClick={onClose}
            className="min-w-[70px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            intent="primary"
            type="button"
            onClick={handleSave}
            className="min-w-[70px]"
          >
            Save
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
