'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { UserRoles } from '@byline/admin/admin-users/components/roles'
import { SetPassword } from '@byline/admin/admin-users/components/set-password'
import { UpdateUser } from '@byline/admin/admin-users/components/update'
import { LocalDateTime } from '@byline/admin/react'
import { useTranslation } from '@byline/i18n/react'
import {
  Button,
  CloseIcon,
  Drawer,
  EditIcon,
  IconButton,
  Modal,
  useToastManager,
} from '@byline/ui/react'
import cx from 'classnames'

import styles from './container.module.css'
import { DeleteUser } from './delete.js'
import type { AdminRoleResponse } from '../../server-fns/admin-roles/index.js'
import type { AdminUserResponse, UserRolesResponse } from '../../server-fns/admin-users/index.js'

/**
 * Detail view for a single admin user, built around Infonomic's drawer
 * pattern: the main view shows cards for each editable area of the
 * record, and each "Edit" button opens a drawer containing the
 * sub-form. Destructive actions (delete) use a modal instead of a
 * drawer.
 *
 * Each sub-panel is a self-contained form component receiving
 * `(user, onClose, onSuccess)`. Forms that return a fresh user (the
 * update and set-password flows) lift it into `currentUser` via
 * `handleSuccess` so subsequent edits see the bumped `vid`. Delete
 * navigates away internally; its `onSuccess` is unused.
 *
 * The roles drawer is special-cased: it needs `allRoles` (the catalog
 * to render the checkbox list) and `initialRoleIds` (pre-checked from
 * the user's current assignments). It's rendered inline against
 * `current === 'roles'` rather than going through the panels map —
 * same trick the role-detail container uses for its permissions
 * panel.
 */

type ComponentKey = 'update' | 'set_password' | 'delete_user' | 'roles' | 'empty'

interface PanelProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

type PanelMeta = {
  drawerWidth: 'medium' | 'large'
  component: React.ComponentType<PanelProps>
  titleKey: string
}

const panelMeta: Record<ComponentKey, PanelMeta> = {
  update: {
    drawerWidth: 'medium',
    component: UpdateUser,
    titleKey: 'adminUsers.detail.panels.update',
  },
  set_password: {
    drawerWidth: 'medium',
    component: SetPassword,
    titleKey: 'adminUsers.detail.panels.setPassword',
  },
  delete_user: {
    drawerWidth: 'medium',
    component: DeleteUser,
    titleKey: 'adminUsers.detail.panels.delete',
  },
  roles: {
    drawerWidth: 'medium',
    // See container header docstring — rendered inline, this is a stub.
    component: () => null,
    titleKey: 'adminUsers.detail.panels.roles',
  },
  empty: {
    drawerWidth: 'medium',
    component: () => null,
    titleKey: '',
  },
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
    <div className={cx('byline-admin-user-section', styles.section)}>
      <div className={cx('byline-admin-user-section-head', styles.sectionHead)}>
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

function RoleBadge({ role }: { role: AdminRoleResponse }) {
  return (
    <span
      title={role.machine_name}
      className={cx('byline-admin-user-role-badge', styles.roleBadge)}
    >
      {role.name}
    </span>
  )
}

interface AccountContainerProps {
  user: AdminUserResponse
  allRoles: AdminRoleResponse[]
  initialUserRoles: AdminRoleResponse[]
}

export function AccountContainer({ user, allRoles, initialUserRoles }: AccountContainerProps) {
  const router = useRouter()
  const toastManager = useToastManager()
  const { t } = useTranslation('byline-admin')
  const [currentUser, setCurrentUser] = useState<AdminUserResponse>(user)
  const [currentUserRoles, setCurrentUserRoles] = useState<AdminRoleResponse[]>(initialUserRoles)
  const [current, setCurrent] = useState<ComponentKey>('empty')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const openDrawer = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsDrawerOpen(true)
  }
  const openModal = (key: ComponentKey) => () => {
    setCurrent(key)
    setIsModalOpen(true)
  }
  const closeDrawer = () => {
    setCurrent('empty')
    setIsDrawerOpen(false)
  }
  const closeModal = () => {
    setCurrent('empty')
    setIsModalOpen(false)
  }

  const handleSuccess = (updated: AdminUserResponse) => {
    setCurrentUser(updated)
  }

  const handleRolesSaved = (response: UserRolesResponse) => {
    setCurrentUserRoles(response.roles)
    void router.invalidate()
    toastManager.add({
      title: t('adminUsers.detail.rolesSavedToast'),
      description: t('adminUsers.detail.rolesAssignedDescription', {
        count: response.roles.length,
        email: currentUser.email,
      }),
      data: { intent: 'success' },
    })
  }

  const currentMeta = panelMeta[current]
  const Panel = currentMeta.component
  const currentTitle = currentMeta.titleKey ? t(currentMeta.titleKey) : ''
  const editAriaFor = (section: string) => t('account.editAriaLabel', { section })

  return (
    <>
      <div className={cx('byline-admin-user-grid', styles.grid)}>
        <div className={cx('byline-admin-user-column', styles.column)}>
          <ContainerSection
            title={t('adminUsers.detail.sections.account')}
            onEdit={openDrawer('update')}
            editAriaLabel={editAriaFor(t('adminUsers.detail.sections.account'))}
          >
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.profile.emailColon')}</span> {currentUser.email}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.profile.givenName')}</span>{' '}
              {currentUser.given_name ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.profile.familyName')}</span>{' '}
              {currentUser.family_name ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.profile.username')}</span>{' '}
              {currentUser.username ?? (
                <span className={cx('muted byline-admin-user-not-set', styles.notSet)}>
                  {t('common.notSet')}
                </span>
              )}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.status.superAdmin')}</span>{' '}
              {currentUser.is_super_admin ? t('common.boolean.yes') : t('common.boolean.no')}
            </p>
            <p className={cx('byline-admin-user-line', styles.line)}>
              <span className="muted">{t('account.status.emailVerified')}</span>{' '}
              {currentUser.is_email_verified ? t('common.boolean.yes') : t('common.boolean.no')}
            </p>
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              <span className="muted">{t('account.status.status')}</span>{' '}
              <span
                className={cx({
                  'byline-admin-user-status-on': currentUser.is_enabled,
                  [styles.statusOn]: currentUser.is_enabled,
                  'byline-admin-user-status-off': !currentUser.is_enabled,
                  [styles.statusOff]: !currentUser.is_enabled,
                })}
              >
                {currentUser.is_enabled
                  ? t('account.status.enabled')
                  : t('account.status.disabled')}
              </span>
            </p>
            <Button size="sm" onClick={openDrawer('update')}>
              {t('adminUsers.detail.updateButton')}
            </Button>
            <div className={cx('muted byline-admin-user-meta', styles.meta)}>
              <p>
                <span className="font-bold">{t('account.profile.created')}&nbsp;</span>
                <LocalDateTime value={currentUser.created_at} />
              </p>
              <p>
                <span className="font-bold">{t('account.profile.updated')}&nbsp;</span>
                <LocalDateTime value={currentUser.updated_at} />
              </p>
              <p className={cx('byline-admin-user-line', styles.line)}>
                <span className="font-bold">{t('account.profile.lastLogin')}&nbsp;</span>
                <LocalDateTime value={currentUser.last_login} fallback={t('common.never')} />
              </p>
            </div>
          </ContainerSection>
        </div>

        <div className={cx('byline-admin-user-column', styles.column)}>
          <ContainerSection
            title={t('adminUsers.detail.sections.roles')}
            onEdit={openDrawer('roles')}
            editAriaLabel={editAriaFor(t('adminUsers.detail.sections.roles'))}
          >
            {currentUserRoles.length === 0 ? (
              <p className={cx('muted byline-admin-user-role-empty', styles.roleEmpty)}>
                {t('adminUsers.detail.rolesEmpty')}
              </p>
            ) : (
              <div className={cx('byline-admin-user-role-list', styles.roleList)}>
                {currentUserRoles.map((role) => (
                  <RoleBadge key={role.id} role={role} />
                ))}
              </div>
            )}
            <Button size="sm" onClick={openDrawer('roles')}>
              {t('adminUsers.detail.editRolesButton')}
            </Button>
          </ContainerSection>

          <ContainerSection
            title={t('adminUsers.detail.sections.password')}
            onEdit={openDrawer('set_password')}
            editAriaLabel={editAriaFor(t('adminUsers.detail.sections.password'))}
          >
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              {t('adminUsers.detail.password.intro')}
            </p>
            <Button size="sm" onClick={openDrawer('set_password')}>
              {t('adminUsers.detail.password.setButton')}
            </Button>
          </ContainerSection>

          <ContainerSection title={t('adminUsers.detail.sections.delete')}>
            <p className={cx('byline-admin-user-line-spaced', styles.lineSpaced)}>
              {t('adminUsers.detail.delete.intro')}
            </p>
            <Button size="sm" intent="danger" onClick={openModal('delete_user')}>
              {t('adminUsers.detail.delete.button')}
            </Button>
          </ContainerSection>
        </div>
      </div>

      <Drawer
        id="admin-user-drawer"
        closeOnOverlayClick={false}
        width="medium"
        topOffset="46px"
        isOpen={isDrawerOpen}
        onDismiss={closeDrawer}
        className={cx({
          'byline-admin-user-drawer-large': currentMeta.drawerWidth === 'large',
          [styles.drawerLarge]: currentMeta.drawerWidth === 'large',
          'byline-admin-user-drawer': currentMeta.drawerWidth !== 'large',
          [styles.drawer]: currentMeta.drawerWidth !== 'large',
        })}
      >
        <Drawer.Container aria-hidden={!isDrawerOpen} className="p-2">
          <Drawer.TopActions>
            <button type="button" tabIndex={0} className="sr-only">
              no action
            </button>
            <IconButton aria-label={t('common.actions.close')} size="sm" onClick={closeDrawer}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon stroke-white" />
            </IconButton>
          </Drawer.TopActions>
          <Drawer.Header>
            <h2>{currentTitle}</h2>
          </Drawer.Header>
          <Drawer.Content>
            <div className={cx('byline-admin-user-drawer-scroll', styles.drawerScroll)}>
              {current === 'roles' ? (
                <UserRoles
                  user={currentUser}
                  allRoles={allRoles}
                  initialRoleIds={currentUserRoles.map((r) => r.id)}
                  onClose={closeDrawer}
                  onSaved={handleRolesSaved}
                />
              ) : (
                <Panel user={currentUser} onClose={closeDrawer} onSuccess={handleSuccess} />
              )}
            </div>
          </Drawer.Content>
        </Drawer.Container>
      </Drawer>

      <Modal isOpen={isModalOpen} onDismiss={closeModal} closeOnOverlayClick={false}>
        <Modal.Container className={cx('byline-admin-user-modal', styles.modal)}>
          <Modal.Header className={cx('byline-admin-user-modal-head', styles.modalHead)}>
            <h3 className="m-0">{currentTitle}</h3>
            <IconButton aria-label={t('common.actions.close')} size="sm" onClick={closeModal}>
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Panel user={currentUser} onClose={closeModal} onSuccess={handleSuccess} />
        </Modal.Container>
      </Modal>
    </>
  )
}
