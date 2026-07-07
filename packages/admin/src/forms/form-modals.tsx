'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useTranslation } from '@byline/i18n/react'
import { Button, CloseIcon, IconButton, Modal } from '@byline/ui/react'
import cx from 'classnames'

import styles from './form-renderer.module.css'

/**
 * Shown when the editor triggers a guarded action (status change, duplicate,
 * copy-to-locale) while the form is dirty. Those actions operate on the saved
 * version, so the editor must save first.
 */
export const UnsavedChangesModal = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation('byline-admin')
  return (
    <Modal isOpen={true} closeOnOverlayClick={true} onDismiss={onClose}>
      <Modal.Container style={{ maxWidth: '460px' }}>
        <Modal.Header className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}>
          <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
            {t('forms.unsavedChanges.title')}
          </h3>
        </Modal.Header>
        <Modal.Content>
          <p className={cx('byline-form-guard-modal-text', styles['guard-modal-text'])}>
            {t('forms.unsavedChanges.message')}
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button
            size="sm"
            style={{ minWidth: '60px' }}
            intent="primary"
            type="button"
            onClick={onClose}
          >
            {t('forms.unsavedChanges.okButton')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}

/**
 * Confirms an immediate, non-versioned write of the document-grain system
 * fields (path / advertised locales) — which does NOT reset workflow status.
 * When content is also dirty, the copy reassures that content edits still
 * follow the normal revision + publish workflow. See docs/07-internationalization/index.md.
 */
export const SystemFieldsConfirmModal = ({
  contentDirty,
  pathDirty,
  availableLocalesDirty,
  onCancel,
  onConfirm,
}: {
  contentDirty: boolean
  pathDirty: boolean
  availableLocalesDirty: boolean
  onCancel: () => void
  onConfirm: () => void
}) => {
  const { t } = useTranslation('byline-admin')
  return (
    <Modal isOpen={true} closeOnOverlayClick={true} onDismiss={onCancel}>
      <Modal.Container style={{ maxWidth: '520px' }}>
        <Modal.Header className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}>
          <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
            {contentDirty
              ? t('forms.systemFieldsConfirm.bothTitle')
              : t('forms.systemFieldsConfirm.title')}
          </h3>
          <IconButton aria-label={t('common.actions.close')} size="xs" onClick={onCancel}>
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content className="prose">
          {/* Lead with reassurance: content edits follow the normal
              revision + publish workflow. The immediate, document-level
              system-field write is explained below the divider. */}
          {contentDirty && (
            <p className={cx('byline-form-system-fields-content-note', 'm-0 mt-2')}>
              {t('forms.systemFieldsConfirm.contentNote')}
            </p>
          )}
          <p
            className="m-0 mt-2"
            style={
              contentDirty
                ? {
                    marginTop: 'var(--spacing-8)',
                    paddingTop: 'var(--spacing-12)',
                    borderTop: '1px solid var(--border-color)',
                  }
                : undefined
            }
          >
            {t('forms.systemFieldsConfirm.intro')}
          </p>
          <ul className={cx('byline-form-system-fields-list', styles['guard-modal-text'], 'm-0')}>
            {pathDirty && <li>{t('forms.systemFieldsConfirm.bulletPath')}</li>}
            {availableLocalesDirty && <li>{t('forms.systemFieldsConfirm.bulletLocales')}</li>}
          </ul>
          <p
            className={cx('byline-form-system-fields-effect', styles['guard-modal-text'])}
            style={{
              marginTop: 'var(--spacing-4)',
              marginBottom: 0,
              color: 'var(--text-subtle)',
            }}
          >
            {t('forms.systemFieldsConfirm.effectLine')}
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button
            size="sm"
            style={{ minWidth: '80px' }}
            intent="noeffect"
            type="button"
            onClick={onCancel}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            style={{ minWidth: '80px' }}
            intent="primary"
            type="button"
            onClick={onConfirm}
          >
            {t('forms.systemFieldsConfirm.confirmButton')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}

/**
 * Blocks router navigation / browser unload while the form is dirty. Driven by
 * the navigation-guard adapter's `isBlocked` state; `onStay` keeps the editor
 * on the page, `onProceed` discards and continues.
 */
export const NavigationGuardModal = ({
  onStay,
  onProceed,
}: {
  onStay: () => void
  onProceed: () => void
}) => {
  const { t } = useTranslation('byline-admin')
  return (
    <Modal isOpen={true} closeOnOverlayClick={false} onDismiss={onStay}>
      <Modal.Container style={{ maxWidth: '460px' }}>
        <Modal.Header className={cx('byline-form-guard-modal-head', styles['guard-modal-head'])}>
          <h3 className={cx('byline-form-guard-modal-title', styles['guard-modal-title'])}>
            {t('forms.navigationGuard.title')}
          </h3>
        </Modal.Header>
        <Modal.Content>
          <p className={cx('byline-form-guard-modal-text', styles['guard-modal-text'])}>
            {t('forms.navigationGuard.message')}
          </p>
        </Modal.Content>
        <Modal.Actions>
          <Button size="sm" intent="noeffect" type="button" onClick={onStay}>
            {t('forms.navigationGuard.stayButton')}
          </Button>
          <Button size="sm" intent="danger" type="button" onClick={onProceed}>
            {t('forms.navigationGuard.leaveButton')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
