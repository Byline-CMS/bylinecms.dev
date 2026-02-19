'use client'

/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
