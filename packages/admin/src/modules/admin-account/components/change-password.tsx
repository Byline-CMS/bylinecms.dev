'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service change-password drawer form.
 *
 * Distinct from the admin-users `set-password.tsx`:
 *
 *   - Requires the current password as defence against
 *     session-hijack abuse. The server verifies it against the
 *     stored hash before swapping in the new one — wrong current
 *     password surfaces as `admin.account.invalidCurrentPassword`.
 *   - Confirmation field catches typos before round-trip.
 *
 * Caveat: changing the password here does not revoke other active
 * sessions today. Existing access tokens stay valid until expiry
 * (~15 min); a "sign out everywhere on password change" follow-up
 * will close that gap.
 */

import { useMemo, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { passwordSchema } from '@byline/core/validation'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, InputPassword, LoaderEllipsis } from '@byline/ui/react'
import cx from 'classnames'
import { z } from 'zod'

import { translateValidationError } from '../../../lib/translate-validation-error.js'
import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './change-password.module.css'
import type { AccountResponse } from '../index.js'

type ChangePasswordValues = {
  currentPassword: string
  newPassword: string
  confirm: string
}

interface ChangePasswordProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

export function ChangeAccountPassword({ account, onClose, onSuccess }: ChangePasswordProps) {
  const { changeAccountPassword } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Schema rebuilt per-render so error messages reflect the active
  // locale. `passwordSchema` from `@byline/core/validation` emits stable
  // error codes — `translateValidationError(t, …)` below maps them onto
  // the active locale at render time.
  const changePasswordFormSchema = useMemo(
    () =>
      z
        .object({
          currentPassword: z
            .string()
            .min(1, { message: t('account.changePassword.errors.currentRequired') }),
          newPassword: passwordSchema,
          confirm: z.string({
            message: t('account.changePassword.errors.confirmRequired'),
          }),
        })
        .refine((v) => v.newPassword === v.confirm, {
          message: t('account.changePassword.errors.mismatch'),
          path: ['confirm'],
        }),
    [t]
  )

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' } as ChangePasswordValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: changePasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      try {
        const updated = await changeAccountPassword({
          data: {
            vid: account.vid,
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
          },
        })
        setSuccessMessage(t('account.changePassword.feedback.updated'))
        form.reset({ currentPassword: '', newPassword: '', confirm: '' })
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.account.invalidCurrentPassword') {
          const message = t('account.changePassword.errors.currentIncorrect')
          form.setFieldMeta('currentPassword', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: message },
            errors: [message],
          }))
          return
        }
        if (code === 'admin.users.versionConflict') {
          setFormError(t('common.errors.versionConflict'))
          return
        }
        if (code === 'admin.account.notFound') {
          setFormError(t('common.errors.accountNotFound'))
          return
        }
        setFormError(t('account.changePassword.errors.couldNotChange'))
      }
    },
  })

  return (
    <div className={cx('byline-account-change-password-wrap', styles.wrap)}>
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-account-change-password-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <p className="muted">{t('account.changePassword.intro')}</p>

        <form.Field name="currentPassword">
          {(field) => (
            <InputPassword
              label={t('account.changePassword.fields.current')}
              id="currentPassword"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="current-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="newPassword">
          {(field) => (
            <InputPassword
              label={t('account.changePassword.fields.new')}
              id="newPassword"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={translateValidationError(t, firstError(field.state.meta.errors))}
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

        <div className={cx('byline-account-change-password-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-account-change-password-action', styles.action)}
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
                className={cx('byline-account-change-password-action', styles.action)}
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
