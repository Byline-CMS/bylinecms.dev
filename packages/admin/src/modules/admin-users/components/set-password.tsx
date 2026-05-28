'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Set-password drawer form.
 *
 * Admin-facing "set this user's password" flow — used when an admin is
 * resetting someone else's password. Server-side policy (min 12 chars,
 * max 256) is duplicated client-side via Zod for immediate field
 * validation. A matching-confirmation field catches typos without a
 * round-trip.
 *
 * The server fn returns the updated user so we can lift the bumped
 * `vid` back into the container; the drawer doesn't need to re-fetch.
 */

import { useMemo, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { passwordSchema } from '@byline/core/validation'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, InputPassword, LoaderEllipsis } from '@byline/ui/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './set-password.module.css'
import type { AdminUserResponse } from '../index.js'

type SetPasswordValues = {
  password: string
  confirm: string
}

interface SetPasswordProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

export function SetPassword({ user, onClose, onSuccess }: SetPasswordProps) {
  const { setAdminUserPassword } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const setPasswordFormSchema = useMemo(
    () =>
      z
        .object({
          password: passwordSchema,
          confirm: z.string({
            message: t('account.changePassword.errors.confirmRequired'),
          }),
        })
        .refine((v) => v.password === v.confirm, {
          message: t('account.changePassword.errors.mismatch'),
          path: ['confirm'],
        }),
    [t]
  )

  const form = useForm({
    defaultValues: { password: '', confirm: '' } as SetPasswordValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: setPasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      try {
        const updated = await setAdminUserPassword({
          data: { id: user.id, vid: user.vid, password: value.password },
        })
        setSuccessMessage(t('account.changePassword.feedback.updated'))
        form.reset({ password: '', confirm: '' })
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.versionConflict') {
          setFormError(t('adminUsers.update.errors.versionConflict'))
          return
        }
        if (code === 'admin.users.notFound') {
          setFormError(t('adminUsers.update.errors.notFound'))
          return
        }
        setFormError(t('adminUsers.setPassword.errors.fallback'))
      }
    },
  })

  return (
    <div className={cx('byline-user-set-password-wrap', styles.wrap)}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-user-set-password-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <p className="muted">{t('adminUsers.setPassword.intro', { email: user.email })}</p>

        <form.Field name="password">
          {(field) => (
            <InputPassword
              label={t('account.changePassword.fields.new')}
              id="password"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="confirm">
          {(field) => (
            <InputPassword
              label={t('account.changePassword.fields.confirm')}
              id="confirm"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <div className={cx('byline-user-set-password-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-user-set-password-action', styles.action)}
          >
            {successMessage ? t('common.actions.close') : t('common.actions.cancel')}
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              isDirty: state.isDirty,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                size="sm"
                intent="primary"
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className={cx('byline-user-set-password-action', styles.action)}
              >
                {isSubmitting === true ? <LoaderEllipsis size={42} /> : t('common.actions.save')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </div>
  )
}

function firstError(errors: readonly unknown[]): string | undefined {
  for (const err of errors) {
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === 'string') return msg
    }
  }
  return undefined
}

function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
