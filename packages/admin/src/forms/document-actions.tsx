'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
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
} from '@byline/ui/react'
import cx from 'classnames'

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
  const { t } = useTranslation('byline-admin')
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
                    <button type="button">{t('documentActions.copyToLocaleMenuItem')}</button>
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
                    <button type="button">{t('common.actions.duplicate')}</button>
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
                    {t('common.actions.delete')}
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
              {t('documentActions.delete.title')}
            </h3>
            <IconButton
              arial-label={t('common.actions.close')}
              size="xs"
              onClick={() => {
                setShowDeleteConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p>{t('documentActions.delete.warning')}</p>
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
              {t('common.actions.cancel')}
            </Button>
            <Button size="sm" style={{ minWidth: '80px' }} intent="danger" onClick={handleOnDelete}>
              {t('common.actions.delete')}
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
              {t('documentActions.duplicate.title')}
            </h3>
            <IconButton
              arial-label={t('common.actions.close')}
              size="xs"
              onClick={() => {
                if (!duplicateBusy) setShowDuplicateConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content className="prose">
            <p className="m-0">{t('documentActions.duplicate.intro')}</p>
            <ul className={cx('byline-form-actions-list', styles.list)}>
              <li>
                {t('documentActions.duplicate.bulletTitle')}{' '}
                <code>{DUPLICATE_TITLE_SUFFIX.trim()}</code>.
              </li>
              <li>{t('documentActions.duplicate.bulletPath')}</li>
            </ul>
            {sourceTitle != null && sourceTitle.length > 0 && (
              <div className={cx('byline-form-actions-preview', styles.preview)}>
                <div className={cx('byline-form-actions-preview-label', styles['preview-label'])}>
                  {t('documentActions.duplicate.previewLabel')}
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
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              style={{ minWidth: '80px' }}
              intent="primary"
              onClick={handleOnDuplicate}
              disabled={duplicateBusy}
            >
              {duplicateBusy
                ? t('documentActions.duplicate.busyButton')
                : t('common.actions.duplicate')}
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
              {t('documentActions.copyToLocale.title')}
            </h3>
            <IconButton
              arial-label={t('common.actions.close')}
              size="xs"
              onClick={() => {
                if (!copyToLocaleBusy) setShowCopyToLocaleConfirm(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p>{t('documentActions.copyToLocale.intro')}</p>
            <div
              className={cx('byline-form-actions-copy-row', styles['copy-row'])}
              style={{ marginTop: 'var(--spacing-12)' }}
            >
              <span
                className={cx('byline-form-actions-copy-label', styles['copy-label'])}
                style={{ fontWeight: 500 }}
              >
                {t('documentActions.copyToLocale.fromLabel')}&nbsp;
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
                {t('documentActions.copyToLocale.toLabel')}
              </span>
              <Select<string>
                size="sm"
                ariaLabel={t('documentActions.copyToLocale.targetAriaLabel')}
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
                label={t('documentActions.copyToLocale.overwriteLabel')}
                checked={copyOverwrite}
                disabled={copyToLocaleBusy}
                helpText={t('documentActions.copyToLocale.overwriteHelp')}
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
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              style={{ minWidth: '80px' }}
              intent="primary"
              onClick={handleOnCopyToLocale}
              disabled={copyToLocaleBusy || !copyTargetLocale}
            >
              {copyToLocaleBusy
                ? t('documentActions.copyToLocale.busyButton')
                : t('documentActions.copyToLocale.confirmButton')}
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </>
  )
}
