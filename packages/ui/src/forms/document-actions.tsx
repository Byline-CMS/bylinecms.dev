/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import {
  Button,
  CloseIcon,
  DeleteIcon,
  Dropdown as DropdownComponent,
  EllipsisIcon,
  IconButton,
  Modal,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './document-actions.module.css'
import type { PublishedVersionInfo } from './form-renderer'

export function DocumentActions({
  publishedVersion,
  onUnpublish,
  onDelete,
}: {
  publishedVersion?: PublishedVersionInfo | null
  onUnpublish?: () => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleOnDelete = () => {
    setShowDeleteConfirm(false)
    if (onDelete) {
      onDelete()
    }
  }

  return (
    <>
      <DropdownComponent.Root>
        <DropdownComponent.Trigger
          render={<IconButton variant="text" intent="noeffect" size="sm" />}
        >
          <EllipsisIcon
            className={cx('byline-form-actions-icon', styles.icon)}
            width="15px"
            height="15px"
          />
        </DropdownComponent.Trigger>

        <DropdownComponent.Portal>
          <DropdownComponent.Content
            className={cx('byline-form-actions-menu', styles.menu)}
            align="end"
            data-side="top"
            sideOffset={10}
          >
            {publishedVersion && (
              <>
                <DropdownComponent.Item onClick={onUnpublish}>
                  <div className={cx('byline-form-actions-item', styles.item)}>
                    <span className={cx('byline-form-actions-item-icon', styles['item-icon'])} />
                    <span className={cx('byline-form-actions-item-text', styles['item-text'])}>
                      Unpublish
                    </span>
                  </div>
                </DropdownComponent.Item>
                <DropdownComponent.Separator />
              </>
            )}
            <DropdownComponent.Item
              onClick={() => {
                setShowDeleteConfirm(true)
              }}
            >
              <div className={cx('byline-form-actions-item', styles.item)}>
                <span className={cx('byline-form-actions-item-icon', styles['item-icon'])}>
                  <DeleteIcon width="16px" height="16px" />
                </span>
                <span className={cx('byline-form-actions-item-text', styles['item-text'])}>
                  <button type="button" className={cx('byline-form-actions-delete', styles.delete)}>
                    Delete
                  </button>
                </span>
              </div>
            </DropdownComponent.Item>
          </DropdownComponent.Content>
        </DropdownComponent.Portal>
      </DropdownComponent.Root>

      <Modal
        isOpen={showDeleteConfirm}
        closeOnOverlayClick={true}
        onDismiss={() => {
          setShowDeleteConfirm(false)
        }}
      >
        <Modal.Container style={{ maxWidth: '500px' }}>
          <Modal.Header className={cx('byline-form-actions-modal-head', styles['modal-head'])}>
            <h3 className={cx('byline-form-actions-modal-title', styles['modal-title'])}>
              Delete Document
            </h3>
            <IconButton
              arial-label="Close"
              size="xs"
              onClick={() => {
                setShowDeleteConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p>
              Warning: This action cannot be undone. Are you sure you want to delete this document?
            </p>
          </Modal.Content>
          <Modal.Actions>
            <button
              data-autofocus
              type="button"
              tabIndex={0}
              className={cx('byline-form-actions-sr-only', styles['sr-only'])}
            >
              no action
            </button>
            <Button
              size="sm"
              intent="noeffect"
              onClick={() => {
                setShowDeleteConfirm(false)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" intent="danger" onClick={handleOnDelete}>
              Delete
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </>
  )
}
