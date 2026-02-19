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
import { useEffect, useState } from 'react'

import { Button, CloseIcon, IconButton, Input, Modal } from '@infonomic/uikit/react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { INSERT_TABLE_COMMAND } from '@lexical/table'

import './table-modal.css'

export function TableModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [activeEditor] = useState(editor)

  const [rows, setRows] = useState('5')
  const [columns, setColumns] = useState('5')
  const [isDisabled, setIsDisabled] = useState(true)

  useEffect(() => {
    const row = Number(rows)
    const column = Number(columns)
    if (row !== 0 && row > 0 && row <= 500 && column !== 0 && column > 0 && column <= 50) {
      setIsDisabled(false)
    } else {
      setIsDisabled(true)
    }
  }, [rows, columns])

  const handleOnSubmit = (): void => {
    activeEditor.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns,
      rows,
    })

    if (onClose != null && typeof onClose === 'function') {
      onClose()
    }
  }

  // TODO - validate
  const handleOnRowsChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setRows(event.target.value)
  }

  // TODO - validate
  const handleOnColumnsChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setColumns(event.target.value)
  }

  const handleOnCancel = (): void => {
    if (onClose != null && typeof onClose === 'function') {
      onClose()
    }
  }

  return (
    <Modal isOpen={open} onDismiss={handleOnCancel} closeOnOverlayClick={false}>
      <Modal.Container className="table-modal-container">
        <Modal.Header className="table-modal-header">
          <h3>Insert Table</h3>
          <IconButton arial-label="Close" size="sm" onClick={handleOnCancel}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content>
          <Input
            id="number-of-rows"
            name="number-of-rows"
            type="number"
            placeholder={'# of rows (1-500)'}
            label="Rows"
            onChange={handleOnRowsChange}
            value={rows}
            data-test-id="table-modal-rows"
          />
          <Input
            id="number-of-columns"
            name="number-of-columns"
            type="number"
            placeholder={'# of columns (1-50)'}
            label="Columns"
            onChange={handleOnColumnsChange}
            value={columns}
            data-test-id="table-modal-columns"
          />
        </Modal.Content>
        <Modal.Actions className="table-modal-actions">
          <Button size="sm" intent="noeffect" onClick={handleOnCancel} data-autofocus>
            Close
          </Button>
          <Button
            size="sm"
            intent="primary"
            onClick={handleOnSubmit}
            disabled={isDisabled}
            data-test-id="table-modal-submit"
          >
            Submit
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
