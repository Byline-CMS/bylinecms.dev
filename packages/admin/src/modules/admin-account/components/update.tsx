'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service profile form.
 *
 * Editable surface is intentionally narrower than the admin-users
 * `update.tsx`: no `is_super_admin`, `is_enabled`, or
 * `is_email_verified` toggles. A user cannot grant themselves
 * super-admin or flip their own status — those flow through the
 * admin-users module on a privileged admin's session.
 *
 * Patch is built diff-style against the loaded row and submitted with
 * the row's `vid` so a concurrent edit elsewhere surfaces as
 * `admin.users.versionConflict` and we prompt for reload.
 */

import { useMemo, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, Input, LoaderEllipsis } from '@byline/ui/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './update.module.css'
import type { AccountResponse } from '../index.js'

// Field-length ceilings sourced from the `adminUsers` schema in @byline/admin
// (100/100/100/254). Kept as constants so error messages can ICU-format them.
const MAX_NAME = 100
const MAX_USERNAME = 100
const MAX_EMAIL = 254

type UpdateAccountValues = {
  given_name: string
  family_name: string
  username: string
  email: string
}

function defaultsFrom(account: AccountResponse): UpdateAccountValues {
  return {
    given_name: account.given_name ?? '',
    family_name: account.family_name ?? '',
    username: account.username ?? '',
    email: account.email,
  }
}

function buildPatch(values: UpdateAccountValues, account: AccountResponse) {
  const patch: {
    given_name?: string | null
    family_name?: string | null
    username?: string | null
    email?: string
  } = {}
  const normaliseText = (value: string): string | null => (value.trim().length > 0 ? value : null)
  const nextGiven = normaliseText(values.given_name)
  const nextFamily = normaliseText(values.family_name)
  const nextUsername = normaliseText(values.username)
  if (nextGiven !== account.given_name) patch.given_name = nextGiven
  if (nextFamily !== account.family_name) patch.family_name = nextFamily
  if (nextUsername !== account.username) patch.username = nextUsername
  if (values.email !== account.email) patch.email = values.email
  return patch
}

interface UpdateAccountProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

export function UpdateAccount({ account, onClose, onSuccess }: UpdateAccountProps) {
  const { updateAccount } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Schema is rebuilt per-render so error messages reflect the active
  // locale. Cheap — small schema, no ahead-of-time compilation cost
  // that matters at this scale. `useMemo` keeps Tanstack Form's
  // validator-identity stable across re-renders.
  const updateAccountSchema = useMemo(
    () =>
      z.object({
        given_name: z
          .string()
          .max(MAX_NAME, t('account.update.errors.givenNameTooLong', { max: MAX_NAME })),
        family_name: z
          .string()
          .max(MAX_NAME, t('account.update.errors.familyNameTooLong', { max: MAX_NAME })),
        username: z
          .string()
          .max(MAX_USERNAME, t('account.update.errors.usernameTooLong', { max: MAX_USERNAME })),
        email: z
          .email({ message: t('account.update.errors.invalidEmail') })
          .min(3)
          .max(MAX_EMAIL, t('account.update.errors.emailTooLong', { max: MAX_EMAIL })),
      }),
    [t]
  )

  const form = useForm({
    defaultValues: defaultsFrom(account),
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: updateAccountSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      const patch = buildPatch(value, account)
      if (Object.keys(patch).length === 0) {
        setSuccessMessage(t('common.feedback.noChanges'))
        return
      }
      try {
        const updated = await updateAccount({ data: { vid: account.vid, patch } })
        setSuccessMessage(t('common.feedback.saved'))
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.emailInUse') {
          const message = t('account.update.errors.emailInUse')
          form.setFieldMeta('email', (meta) => ({
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
        setFormError(t('common.errors.couldNotSave'))
      }
    },
  })

  return (
    <div className={cx('byline-account-update-wrap', styles.wrap)}>
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-account-update-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <form.Field name="given_name">
          {(field) => (
            <Input
              label={t('account.update.fields.givenName')}
              id="given_name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="given-name"
            />
          )}
        </form.Field>

        <form.Field name="family_name">
          {(field) => (
            <Input
              label={t('account.update.fields.familyName')}
              id="family_name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="family-name"
            />
          )}
        </form.Field>

        <form.Field name="username">
          {(field) => (
            <Input
              label={t('account.update.fields.username')}
              id="username"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText={t('account.update.fields.usernameHelp')}
              autoComplete="username"
            />
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Input
              label={t('common.fields.email')}
              id="email"
              name={field.name}
              type="email"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="email"
              required
            />
          )}
        </form.Field>

        <div className={cx('byline-account-update-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-account-update-action', styles.action)}
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
                className={cx('byline-account-update-action', styles.action)}
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
