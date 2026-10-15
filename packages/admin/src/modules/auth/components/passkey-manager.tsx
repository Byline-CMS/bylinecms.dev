'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useId, useRef, useState } from 'react'

import type { PasskeyCredentialSummary } from '@byline/auth'
import { getAdminConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, Input, InputPassword, Modal } from '@byline/ui/react'

import {
  type PasskeyPageBinding,
  useBylineAdminServices,
} from '../../../services/admin-services-context.js'
import { enrollPasskey, passkeyErrorKey, provePasskeyAction } from './passkey-browser.js'
import styles from './passkey-manager.module.css'

type Edit = { kind: 'enroll' } | { kind: 'rename' | 'remove'; credential: PasskeyCredentialSummary }

export function PasskeyManager({
  targetUserId,
  targetIsSuperAdmin = false,
}: {
  targetUserId: string
  targetIsSuperAdmin?: boolean
}) {
  const { passkeys } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const id = useId()
  const binding = useRef<PasskeyPageBinding | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [self, setSelf] = useState(false)
  const [credentials, setCredentials] = useState<PasskeyCredentialSummary[]>([])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    let active = true
    mounted.current = true
    setAllowed(false)
    setEnabled(false)
    setLoading(true)
    setError(null)
    if (passkeys)
      void (async () => {
        if (!(await passkeys.capability()).enabled || !active) return
        setEnabled(true)
        const captured = passkeys.captureLogin()
        const page = {
          ...captured,
          assertCurrent: () => {
            if (!active) throw new Error('Passkey page closed')
            captured.assertCurrent()
          },
        }
        binding.current = page
        const actor = await passkeys.managementContext(page)
        const isSelf = actor.id === targetUserId
        if (!isSelf && (!actor.canManagePasskeys || (targetIsSuperAdmin && !actor.isSuperAdmin)))
          return
        page.assertCurrent()
        setSelf(isSelf)
        setAllowed(true)
        const rows = await passkeys.list({
          data: { expectedSessionId: page.expectedSessionId!, targetUserId },
        })
        page.assertCurrent()
        setCredentials(rows)
        setLoading(false)
      })().catch((error) => {
        if (active) setError(passkeyErrorKey(error))
      })
    return () => {
      active = false
      mounted.current = false
      binding.current = null
    }
  }, [passkeys, targetUserId, targetIsSuperAdmin])

  function open(value: Edit) {
    setEdit(value)
    setName(value.kind === 'rename' ? value.credential.name : '')
    setPassword('')
    setError(null)
    setNotice(null)
  }
  function close() {
    if (pending) return
    setEdit(null)
    setPassword('')
    setError(null)
  }
  async function perform(usePassword: boolean) {
    const page = binding.current
    if (!passkeys || !edit || !page?.expectedSessionId || pending) return
    setPending(true)
    setError(null)
    const suppliedPassword = usePassword ? password : undefined
    setPassword('')
    try {
      page.assertCurrent()
      const expectedSessionId = page.expectedSessionId
      if (edit.kind === 'rename') {
        const updated = await passkeys.rename({
          data: { expectedSessionId, credentialRecordId: edit.credential.id, name: name.trim() },
        })
        page.assertCurrent()
        setCredentials((rows) => rows.map((row) => (row.id === updated.id ? updated : row)))
        setNotice('passkeys.renamed')
      } else if (edit.kind === 'enroll') {
        const created = await enrollPasskey(passkeys, page, name.trim(), suppliedPassword)
        page.assertCurrent()
        setCredentials((rows) => [...rows, created])
        setNotice('passkeys.added')
      } else {
        const grant = await provePasskeyAction(
          passkeys,
          page,
          { purpose: 'remove', targetUserId, credentialRecordId: edit.credential.id },
          suppliedPassword
        )
        page.assertCurrent()
        const result = await passkeys.remove({
          data: { expectedSessionId, grantId: grant.grantId },
        })
        if (result.signedOut) {
          window.location.assign(getAdminConfig().routes.signIn)
          return
        }
        page.assertCurrent()
        setCredentials((rows) => rows.filter((row) => row.id !== edit.credential.id))
        setNotice('passkeys.removed')
      }
      setEdit(null)
    } catch (error) {
      if (mounted.current) setError(passkeyErrorKey(error))
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  if (!passkeys || !enabled) return null
  if (!allowed) return error ? <Alert intent="danger">{t(error)}</Alert> : null
  return (
    <section className={`byline-passkey-manager ${styles.manager}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('passkeys.title')}</h2>
      <p>{t(self ? 'passkeys.description' : 'passkeys.recoveryDescription')}</p>
      {!edit && error && <Alert intent="danger">{t(error)}</Alert>}
      {notice && <p role="status">{t(notice)}</p>}
      {loading ? (
        <p role="status">{t('common.loading')}</p>
      ) : credentials.length === 0 ? (
        <p>{t('passkeys.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {credentials.map((credential) => (
            <li key={credential.id} className={styles.row}>
              <div>
                <strong>{credential.name}</strong>
                <p>
                  {t('passkeys.lastUsed')}:{' '}
                  {credential.lastUsedAt
                    ? new Date(credential.lastUsedAt).toLocaleString()
                    : t('common.never')}
                </p>
              </div>
              <div className={styles.actions}>
                {self && (
                  <Button
                    type="button"
                    variant="text"
                    onClick={() => open({ kind: 'rename', credential })}
                    aria-label={t('passkeys.renameNamed', { name: credential.name })}
                  >
                    {t('passkeys.rename')}
                  </Button>
                )}
                <Button
                  type="button"
                  intent="danger"
                  variant="text"
                  onClick={() => open({ kind: 'remove', credential })}
                  aria-label={t('passkeys.removeNamed', { name: credential.name })}
                >
                  {t('passkeys.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {self && (
        <Button type="button" disabled={loading} onClick={() => open({ kind: 'enroll' })}>
          {t('passkeys.add')}
        </Button>
      )}
      <Modal
        isOpen={edit !== null}
        onDismiss={close}
        closeOnOverlayClick={false}
        ariaLabel={t(
          edit?.kind === 'remove'
            ? 'passkeys.remove'
            : edit?.kind === 'rename'
              ? 'passkeys.rename'
              : 'passkeys.add'
        )}
      >
        <Modal.Container>
          <Modal.Header>
            <h2>
              {t(
                edit?.kind === 'remove'
                  ? 'passkeys.remove'
                  : edit?.kind === 'rename'
                    ? 'passkeys.rename'
                    : 'passkeys.add'
              )}
            </h2>
          </Modal.Header>
          <Modal.Content>
            {error && <Alert intent="danger">{t(error)}</Alert>}
            {edit?.kind === 'remove' ? (
              <p>{t('passkeys.removeWarning', { name: edit.credential.name })}</p>
            ) : (
              <Input
                id={`${id}-name`}
                name="passkey-name"
                label={t('passkeys.name')}
                value={name}
                maxLength={80}
                disabled={pending}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            )}
            {edit?.kind !== 'rename' && (
              <>
                <p>{t('passkeys.proofDescription')}</p>
                <InputPassword
                  id={`${id}-password`}
                  name="passkey-password"
                  label={t('common.fields.password')}
                  autoComplete="current-password"
                  value={password}
                  disabled={pending}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  showPasswordLabel={t('common.actions.showPassword')}
                  hidePasswordLabel={t('common.actions.hidePassword')}
                />
              </>
            )}
            {pending && <p role="status">{t('passkeys.waiting')}</p>}
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" variant="text" disabled={pending} onClick={close}>
              {t('common.actions.cancel')}
            </Button>
            {edit?.kind === 'rename' ? (
              <Button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() => void perform(false)}
              >
                {t('common.actions.save')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  disabled={pending || !password || (edit?.kind === 'enroll' && !name.trim())}
                  onClick={() => void perform(true)}
                >
                  {t('passkeys.usePassword')}
                </Button>
                <Button
                  type="button"
                  disabled={pending || (edit?.kind === 'enroll' && !name.trim())}
                  onClick={() => void perform(false)}
                >
                  {t('passkeys.usePasskey')}
                </Button>
              </>
            )}
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </section>
  )
}
