'use client'

/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type * as React from 'react'
import { useState } from 'react'

import {
  Button,
  CloseIcon,
  IconButton,
  Modal,
  Select,
  SelectItem,
  type SelectValue,
} from '@infonomic/uikit/react'

const layouts: SelectValue[] = [
  { label: '2 columns (equal width)', value: '1fr 1fr' },
  { label: '2 columns (25% - 75%)', value: '1fr 3fr' },
  { label: '2 columns (75% - 25%)', value: '3fr 1fr' },
  { label: '3 columns (equal width)', value: '1fr 1fr 1fr' },
  { label: '3 columns (25% - 50% - 25%)', value: '1fr 2fr 1fr' },
  { label: '4 columns (equal width)', value: '1fr 1fr 1fr 1fr' },
]

import './insert-layout-modal.css'

export function InsertLayoutModal({
  open = false,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (layout: string) => void
}): React.JSX.Element {
  const [layout, setLayout] = useState(layouts[0].value)

  const handleOnCancel = (): void => {
    if (onClose != null && typeof onClose === 'function') {
      onClose()
    }
  }

  const handleOnSubmit = (): void => {
    if (onSubmit != null && typeof onSubmit === 'function') {
      onSubmit(layout)
    }
  }

  return (
    <Modal isOpen={open} onDismiss={handleOnCancel} closeOnOverlayClick={false}>
      <Modal.Container className="insert-layout-modal-container">
        <Modal.Header>
          <h3>Insert Layout</h3>
          <IconButton arial-label="Close" size="sm" onClick={handleOnCancel}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content>
          <Select
            containerClassName="insert-layout-modal-select"
            onValueChange={(value) => {
              setLayout(value)
            }}
            placeholder="Select a layout"
          >
            {layouts.map(({ label, value }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </Select>
        </Modal.Content>
        <Modal.Actions className="insert-layout-modal-actions">
          <Button size="sm" intent="noeffect" onClick={handleOnCancel} data-autofocus>
            Cancel
          </Button>
          <Button
            size="sm"
            intent="primary"
            onClick={handleOnSubmit}
            data-test-id="table-modal-submit"
          >
            Insert
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
