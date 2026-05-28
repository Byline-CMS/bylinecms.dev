'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service account container.
 *
 * Same drawer pattern as `admin-users/ui/container.tsx` but
 * narrower: only Profile and Password sections (no Roles, no
 * Delete) — those are admin-only actions on someone else, not
 * self-service. Each card surfaces the read-only summary plus an
 * "Edit" affordance that opens the matching drawer.
 *
 * Forms lift the fresh `AccountResponse` back into local state on
 * success so the container's bumped `vid` is in hand for any
 * subsequent edit without a refetch.
 *
 * Stable override handles: see `container.module.css`.
 */

import type React from 'react'
import { useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Button, CloseIcon, Drawer, EditIcon, IconButton, LocalDateTime } from '@byline/ui/react'
import cx from 'classnames'

import { ChangeAccountPassword } from './change-password.js'
import styles from './container.module.css'
import { Preferences } from './preferences.js'
import { UpdateAccount } from './update.js'
import type { AccountResponse } from '../index.js'

type ComponentKey = 'update' | 'change_password' | 'preferences' | 'empty'

interface PanelProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

const panelComponents: Record<ComponentKey, React.ComponentType<PanelProps>> = {
  update: UpdateAccount,
  change_password: ChangeAccountPassword,
  preferences: Preferences,
  empty: () => null,
}

function ContainerSection({
  title,
  onEdit,
  editAriaLabel,
  children,
}: {
  title: string
  onEdit?: () => void
  editAriaLabel?: string
  children: React.ReactNode
}) {
  return (
    <div className={cx('byline-account-section', styles.section)}>
      <div className={cx('byline-account-section-head', styles['section-head'])}>
        <h2>{title}</h2>
        {onEdit ? (
          <IconButton variant="text" onClick={onEdit} aria-label={editAriaLabel ?? title}>
            <EditIcon width="20px" height="20px" />
          </IconButton>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

interface AccountSelfContainerProps {
  account: AccountResponse
}

export function AccountSelfContainer({ account }: AccountSelfContainerProps) {
  const { t } = useTranslation('byline-admin')
  const [currentAccount, setCurrentAccount] = useState<AccountResponse>(account)
  const [current, setCurrent] = useState<ComponentKey>('empty')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const openDrawer = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsDrawerOpen(true)
  }
  const closeDrawer = () => {
    setCurrent('empty')
    setIsDrawerOpen(false)
  }
  const handleSuccess = (updated: AccountResponse) => {
    setCurrentAccount(updated)
  }

  const Panel = panelComponents[current]
  const panelTitles: Record<ComponentKey, string> = {
    update: t('account.sections.profile'),
    change_password: t('account.sections.password'),
    preferences: t('account.sections.preferences'),
    empty: '',
  }
  const editAriaFor = (section: string) => t('account.editAriaLabel', { section })

  return (
    <>
      <div className={cx('byline-account-grid', styles.grid)}>
        <div className={cx('byline-account-column', styles.column)}>
          <ContainerSection
            title={t('account.sections.profile')}
            onEdit={openDrawer('update')}
            editAriaLabel={editAriaFor(t('account.sections.profile'))}
          >
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.profile.emailColon')}</span>{' '}
              {currentAccount.email}
            </p>
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.profile.givenName')}</span>{' '}
              {currentAccount.given_name ?? (
                <span className={cx('muted', 'byline-account-not-set', styles['not-set'])}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.profile.familyName')}</span>{' '}
              {currentAccount.family_name ?? (
                <span className={cx('muted', 'byline-account-not-set', styles['not-set'])}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <p className={cx('byline-account-cta-line', styles['cta-line'])}>
              <span className="muted">{t('account.profile.username')}</span>{' '}
              {currentAccount.username ?? (
                <span className={cx('muted', 'byline-account-not-set', styles['not-set'])}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <Button size="sm" onClick={openDrawer('update')}>
              {t('account.profile.editButton')}
            </Button>
            <div className={cx('muted', 'byline-account-meta', styles.meta)}>
              <p>
                <span className="font-bold">{t('account.profile.created')}&nbsp;</span>
                <LocalDateTime value={currentAccount.created_at} />
              </p>
              <p>
                <span className="font-bold">{t('account.profile.updated')}&nbsp;</span>
                <LocalDateTime value={currentAccount.updated_at} />
              </p>
              <p className={cx('byline-account-line', styles.line)}>
                <span className="font-bold">{t('account.profile.lastLogin')}&nbsp;</span>
                <LocalDateTime value={currentAccount.last_login} fallback={t('common.never')} />
              </p>
            </div>
          </ContainerSection>

          <ContainerSection
            title={t('account.sections.preferences')}
            onEdit={openDrawer('preferences')}
            editAriaLabel={editAriaFor(t('account.sections.preferences'))}
          >
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.preferences.interfaceLanguage')}</span>{' '}
              {currentAccount.preferred_locale ?? (
                <span className={cx('muted', 'byline-account-not-set', styles['not-set'])}>
                  {t('language.useBrowserDefault')}
                </span>
              )}
            </p>
            <p className={cx('byline-account-cta-line', styles['cta-line'])}>
              <Button size="sm" onClick={openDrawer('preferences')}>
                {t('account.preferences.editButton')}
              </Button>
            </p>
            <p className={cx('muted', 'byline-account-status-help', styles['status-help'])}>
              {t('account.preferences.help')}
            </p>
          </ContainerSection>
        </div>

        <div className={cx('byline-account-column', styles.column)}>
          <ContainerSection
            title={t('account.sections.password')}
            onEdit={openDrawer('change_password')}
            editAriaLabel={editAriaFor(t('account.sections.password'))}
          >
            <p className={cx('byline-account-cta-line', styles['cta-line'])}>
              {t('account.password.intro')}
            </p>
            <Button size="sm" onClick={openDrawer('change_password')}>
              {t('account.password.editButton')}
            </Button>
          </ContainerSection>

          <ContainerSection title={t('account.sections.status')}>
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.status.superAdmin')}</span>{' '}
              {currentAccount.is_super_admin ? t('common.boolean.yes') : t('common.boolean.no')}
            </p>
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.status.emailVerified')}</span>{' '}
              {currentAccount.is_email_verified ? t('common.boolean.yes') : t('common.boolean.no')}
            </p>
            <p className={cx('byline-account-line', styles.line)}>
              <span className="muted">{t('account.status.status')}</span>{' '}
              <span
                className={
                  currentAccount.is_enabled
                    ? cx('byline-account-status-on', styles['status-on'])
                    : cx('byline-account-status-off', styles['status-off'])
                }
              >
                {currentAccount.is_enabled
                  ? t('account.status.enabled')
                  : t('account.status.disabled')}
              </span>
            </p>
            <p className={cx('muted', 'byline-account-status-help', styles['status-help'])}>
              {t('account.status.help')}
            </p>
          </ContainerSection>
        </div>
      </div>

      <Drawer
        id="admin-account-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className={cx('byline-account-drawer', styles.drawer)}
      >
        <Drawer.Container
          aria-hidden={!isDrawerOpen}
          className={cx('byline-account-drawer-body', styles['drawer-body'])}
        >
          <Drawer.TopActions>
            <button
              type="button"
              tabIndex={0}
              className={cx('byline-account-drawer-skip', styles['drawer-skip'])}
            >
              no action
            </button>
            <IconButton aria-label={t('common.actions.close')} size="sm" onClick={closeDrawer}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon stroke-white" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header>
            <h2>{panelTitles[current]}</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className={cx('byline-account-drawer-scroll', styles['drawer-scroll'])}>
              <Panel account={currentAccount} onClose={closeDrawer} onSuccess={handleSuccess} />
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>
    </>
  )
}
