'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import cx from 'classnames'

import {
  Button,
  Checkbox,
  CloseIcon,
  DeleteIcon,
  Dropdown as DropdownComponent,
  EllipsisIcon,
  IconButton,
  Modal,
  Select,
} from '../uikit.js'
import styles from './document-actions.module.css'
import type { PublishedVersionInfo } from './form-renderer'

const DUPLICATE_TITLE_SUFFIX = ' (copy)'

/**
 * Shape of a content-locale option as consumed by the Copy-to-Locale
 * modal. Matches the host adapter's `ContentLocaleOption`; declared
 * locally so this package does not take a dependency on host code.
 */
export interface DocumentActionsLocaleOption {
  code: string
  label: string
}

export function DocumentActions({
  publishedVersion,
  onUnpublish,
  onDelete,
  onDuplicate,
  sourceTitle,
  onCopyToLocale,
  sourceLocale,
  contentLocales,
}: {
  publishedVersion?: PublishedVersionInfo | null
  onUnpublish?: () => Promise<void>
  onDelete?: () => Promise<void>
  /**
   * Called when the editor confirms the duplicate modal. The parent runs
   * the server fn, surfaces a toast, and navigates to the new document.
   */
  onDuplicate?: () => Promise<void>
  /**
   * The current (saved) value of the source document's `useAsTitle`
   * field, used to render the suffix preview inside the duplicate modal.
   * Sourced from the form's `initialData`, not live form state, so the
   * preview reflects what will actually be duplicated.
   */
  sourceTitle?: string | null
  /**
   * Called when the editor confirms the Copy-to-Locale modal. The
   * parent runs the server fn, surfaces a toast, and navigates to the
   * target locale view. Menu item is hidden when omitted, or when fewer
   * than two content locales are configured.
   */
  onCopyToLocale?: (args: { targetLocale: string; overwrite: boolean }) => Promise<void>
  /**
   * The locale the form is currently displaying. Used as the read-only
   * "From" label in the Copy-to-Locale modal and excluded from the
   * target Select.
   */
  sourceLocale?: string
  /**
   * All configured content locales (code + display label). The
   * Copy-to-Locale Select lists every locale except `sourceLocale`.
   */
  contentLocales?: ReadonlyArray<DocumentActionsLocaleOption>
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)

  // Copy-to-Locale modal state. The menu item is hidden entirely unless
  // the host has supplied a handler AND there is at least one *other*
  // locale to copy into.
  const availableTargetLocales = (contentLocales ?? []).filter((loc) => loc.code !== sourceLocale)
  const copyToLocaleAvailable = onCopyToLocale != null && availableTargetLocales.length > 0
  const [showCopyToLocaleConfirm, setShowCopyToLocaleConfirm] = useState(false)
  const [copyToLocaleBusy, setCopyToLocaleBusy] = useState(false)
  const [copyTargetLocale, setCopyTargetLocale] = useState<string>(
    availableTargetLocales[0]?.code ?? ''
  )
  const [copyOverwrite, setCopyOverwrite] = useState(false)

  const handleOnDelete = () => {
    setShowDeleteConfirm(false)
    if (onDelete) {
      onDelete()
    }
  }

  const handleOnDuplicate = async () => {
    if (!onDuplicate) return
    setDuplicateBusy(true)
    try {
      await onDuplicate()
      setShowDuplicateConfirm(false)
    } finally {
      setDuplicateBusy(false)
    }
  }

  const handleOpenCopyToLocale = () => {
    // Reset on open: pick the first available target and clear the
    // overwrite checkbox so a previous-session "overwrite=true" choice
    // is not silently sticky.
    setCopyTargetLocale(availableTargetLocales[0]?.code ?? '')
    setCopyOverwrite(false)
    setShowCopyToLocaleConfirm(true)
  }

  const handleOnCopyToLocale = async () => {
    if (!onCopyToLocale || !copyTargetLocale) return
    setCopyToLocaleBusy(true)
    try {
      await onCopyToLocale({ targetLocale: copyTargetLocale, overwrite: copyOverwrite })
      setShowCopyToLocaleConfirm(false)
    } finally {
      setCopyToLocaleBusy(false)
    }
  }

  // Preview text shown inside the modal. Falls back to the literal suffix
  // when no source title is supplied (collections without `useAsTitle`).
  const duplicatePreviewBefore = sourceTitle ?? ''
  const duplicatePreviewAfter = (sourceTitle ?? '') + DUPLICATE_TITLE_SUFFIX

  const sourceLocaleLabel =
    contentLocales?.find((loc) => loc.code === sourceLocale)?.label ?? sourceLocale ?? ''

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
            {/*{publishedVersion && (
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
            )}*/}
            {copyToLocaleAvailable && (
              <DropdownComponent.Item onClick={handleOpenCopyToLocale}>
                <div className={cx('byline-form-actions-item', styles.item)}>
                  <span className={cx('byline-form-actions-item-text', styles['item-text'])}>
                    <button type="button">Copy to Locale</button>
                  </span>
                </div>
              </DropdownComponent.Item>
            )}
            {onDuplicate && (
              <DropdownComponent.Item
                onClick={() => {
                  setShowDuplicateConfirm(true)
                }}
              >
                <div className={cx('byline-form-actions-item', styles.item)}>
                  <span className={cx('byline-form-actions-item-text', styles['item-text'])}>
                    <button type="button">Duplicate</button>
                  </span>
                </div>
              </DropdownComponent.Item>
            )}
            <DropdownComponent.Separator />
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
              style={{ minWidth: '80px' }}
              intent="noeffect"
              onClick={() => {
                setShowDeleteConfirm(false)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" style={{ minWidth: '80px' }} intent="danger" onClick={handleOnDelete}>
              Delete
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>

      <Modal
        isOpen={showDuplicateConfirm}
        closeOnOverlayClick={!duplicateBusy}
        onDismiss={() => {
          if (!duplicateBusy) setShowDuplicateConfirm(false)
        }}
      >
        <Modal.Container style={{ maxWidth: '560px' }}>
          <Modal.Header className={cx('byline-form-actions-modal-head', styles['modal-head'])}>
            <h3 className={cx('byline-form-actions-modal-title', styles['modal-title'])}>
              Duplicate Document
            </h3>
            <IconButton
              arial-label="Close"
              size="xs"
              onClick={() => {
                if (!duplicateBusy) setShowDuplicateConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content className="prose">
            <p className="m-0">
              A new document will be created with all translations (if any) cloned from this one.
              After the duplicate is created you should:
            </p>
            <ul className={cx('byline-form-actions-list', styles.list)}>
              <li>
                Update the title of the docuiment (including any translated versions). The title is
                currently suffixed with <code>{DUPLICATE_TITLE_SUFFIX.trim()}</code>.
              </li>
              <li>
                Review the system path in the path widget — the auto-generated path will reflect the
                suffixed title and is unlikely to be what you want long-term.
              </li>
            </ul>
            {sourceTitle != null && sourceTitle.length > 0 && (
              <div className={cx('byline-form-actions-preview', styles.preview)}>
                <div className={cx('byline-form-actions-preview-label', styles['preview-label'])}>
                  Preview (current locale):
                </div>
                <div className={cx('byline-form-actions-preview-row', styles['preview-row'])}>
                  <span
                    className={cx('byline-form-actions-preview-before', styles['preview-before'])}
                  >
                    {duplicatePreviewBefore}
                  </span>
                  <span
                    className={cx('byline-form-actions-preview-arrow', styles['preview-arrow'])}
                  >
                    →
                  </span>
                  <span
                    className={cx('byline-form-actions-preview-after', styles['preview-after'])}
                  >
                    {duplicatePreviewAfter}
                  </span>
                </div>
              </div>
            )}
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
              style={{ minWidth: '80px' }}
              intent="noeffect"
              onClick={() => {
                if (!duplicateBusy) setShowDuplicateConfirm(false)
              }}
              disabled={duplicateBusy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              style={{ minWidth: '80px' }}
              intent="primary"
              onClick={handleOnDuplicate}
              disabled={duplicateBusy}
            >
              {duplicateBusy ? 'Duplicating...' : 'Duplicate'}
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>

      <Modal
        isOpen={showCopyToLocaleConfirm}
        closeOnOverlayClick={!copyToLocaleBusy}
        onDismiss={() => {
          if (!copyToLocaleBusy) setShowCopyToLocaleConfirm(false)
        }}
      >
        <Modal.Container style={{ maxWidth: '560px' }}>
          <Modal.Header className={cx('byline-form-actions-modal-head', styles['modal-head'])}>
            <h3 className={cx('byline-form-actions-modal-title', styles['modal-title'])}>
              Copy to Locale
            </h3>
            <IconButton
              arial-label="Close"
              size="xs"
              onClick={() => {
                if (!copyToLocaleBusy) setShowCopyToLocaleConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p>
              Copy this document's content from one locale to another. Non-localized fields are
              shared across locales and will not change.
            </p>
            <div
              className={cx('byline-form-actions-copy-row', styles['copy-row'])}
              style={{ marginTop: 'var(--spacing-12)' }}
            >
              <span
                className={cx('byline-form-actions-copy-label', styles['copy-label'])}
                style={{ fontWeight: 500 }}
              >
                From:&nbsp;
              </span>
              <span className={cx('byline-form-actions-copy-source', styles['copy-source'])}>
                {sourceLocaleLabel}
              </span>
            </div>
            <div
              className={cx('byline-form-actions-copy-row', styles['copy-row'])}
              style={{ marginTop: 'var(--spacing-12)' }}
            >
              <span
                className={cx('byline-form-actions-copy-label', styles['copy-label'])}
                style={{ fontWeight: 500, marginRight: 'var(--spacing-8)' }}
              >
                To:
              </span>
              <Select<string>
                size="sm"
                ariaLabel="Target locale"
                value={copyTargetLocale}
                items={availableTargetLocales.map((loc) => ({
                  value: loc.code,
                  label: loc.label,
                }))}
                onValueChange={(value) => {
                  if (value != null) setCopyTargetLocale(value)
                }}
                disabled={copyToLocaleBusy}
              />
            </div>
            <div
              className={cx('byline-form-actions-copy-row', styles['copy-row'])}
              style={{ marginTop: 'var(--spacing-16)' }}
            >
              <Checkbox
                id="copy-to-locale-overwrite"
                name="overwrite"
                label="Overwrite existing field data in target locale"
                checked={copyOverwrite}
                disabled={copyToLocaleBusy}
                helpText="Unchecked: only fill in target fields that are currently empty. Checked: replace every translated field with the source's value."
                onCheckedChange={(value) => {
                  setCopyOverwrite(value === true)
                }}
              />
            </div>
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
              style={{ minWidth: '80px' }}
              intent="noeffect"
              onClick={() => {
                if (!copyToLocaleBusy) setShowCopyToLocaleConfirm(false)
              }}
              disabled={copyToLocaleBusy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              style={{ minWidth: '80px' }}
              intent="primary"
              onClick={handleOnCopyToLocale}
              disabled={copyToLocaleBusy || !copyTargetLocale}
            >
              {copyToLocaleBusy ? 'Copying...' : 'Copy'}
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </>
  )
}
