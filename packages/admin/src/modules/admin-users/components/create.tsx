'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Create-admin-user drawer form.
 *
 * Rendered inside the list-view drawer. Same TanStack Form + Zod shape
 * as the AccountDetails form — fields, blur-then-change validation,
 * form-level alerts for errors that don't map onto a single field. On
 * success the parent list-view navigates to the new user's detail page
 * so the admin can finish configuring (roles, initial enablement).
 *
 * Extension point: future props (e.g. a `roles` array once the
 * admin-roles module lands) plug in here — the list-route loader
 * already runs in parallel, so adding a side-data fetch is a one-line
 * change in the loader and a prop here.
 */

import { useMemo, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { passwordSchema } from '@byline/core/validation'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, Checkbox, Input, LoaderEllipsis } from '@byline/ui/react'
import cx from 'classnames'
import { z } from 'zod'

import { translateValidationError } from '../../../lib/translate-validation-error.js'
import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './create.module.css'
import type { AdminUserResponse } from '../index.js'

const MAX_NAME = 100
const MAX_USERNAME = 100
const MAX_EMAIL = 254

type CreateAdminUserValues = {
  email: string
  password: string
  given_name: string
  family_name: string
  username: string
  is_super_admin: boolean
  is_enabled: boolean
  is_email_verified: boolean
}

const initialValues: CreateAdminUserValues = {
  email: '',
  password: '',
  given_name: '',
  family_name: '',
  username: '',
  is_super_admin: false,
  // Sensible defaults for an admin-created row. A brand-new admin user
  // is almost always meant to sign in straight away; the admin picks
  // whether they arrive pre-verified.
  is_enabled: true,
  is_email_verified: false,
}

function normaliseText(value: string): string | null {
  return value.trim().length > 0 ? value : null
}

interface CreateAdminUserProps {
  onClose?: () => void
  /** Called on successful create with the new user so the parent can navigate. */
  onSuccess?: (user: AdminUserResponse) => void
}

export function CreateAdminUser({ onClose, onSuccess }: CreateAdminUserProps) {
  const { createAdminUser } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const [formError, setFormError] = useState<string | null>(null)

  // Schema rebuilt per-render so error messages reflect the active
  // locale; wrapped in useMemo([t]) to keep validator identity stable.
  const createAdminUserFormSchema = useMemo(
    () =>
      z.object({
        email: z
          .email({ message: t('account.update.errors.invalidEmail') })
          .min(3)
          .max(MAX_EMAIL, t('account.update.errors.emailTooLong', { max: MAX_EMAIL })),
        password: passwordSchema,
        given_name: z
          .string()
          .max(MAX_NAME, t('account.update.errors.givenNameTooLong', { max: MAX_NAME })),
        family_name: z
          .string()
          .max(MAX_NAME, t('account.update.errors.familyNameTooLong', { max: MAX_NAME })),
        username: z
          .string()
          .max(MAX_USERNAME, t('account.update.errors.usernameTooLong', { max: MAX_USERNAME })),
        is_super_admin: z.boolean(),
        is_enabled: z.boolean(),
        is_email_verified: z.boolean(),
      }),
    [t]
  )

  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: createAdminUserFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      try {
        const created = await createAdminUser({
          data: {
            email: value.email,
            password: value.password,
            given_name: normaliseText(value.given_name),
            family_name: normaliseText(value.family_name),
            username: normaliseText(value.username),
            is_super_admin: value.is_super_admin,
            is_enabled: value.is_enabled,
            is_email_verified: value.is_email_verified,
          },
        })
        // Clear the form so the next drawer open starts fresh — the
        // list-view shows the success as a toast and keeps the drawer
        // closed until the user clicks "+" again.
        form.reset(initialValues)
        onSuccess?.(created)
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
        setFormError(t('adminUsers.create.errors.fallback'))
      }
    },
  })

  return (
    <div className={cx('byline-user-create-wrap', styles.wrap)}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-user-create-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}

        <div className={cx('byline-user-create-grid', styles.grid)}>
          <form.Field name="given_name">
            {(field) => (
              <Input
                label={t('account.update.fields.givenName')}
                id="new-given-name"
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
                id="new-family-name"
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
        </div>

        <form.Field name="username">
          {(field) => (
            <Input
              label={t('account.update.fields.username')}
              id="new-username"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText={t('adminUsers.create.fields.usernameHelp')}
              autoComplete="username"
            />
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Input
              label={t('common.fields.email')}
              id="new-email"
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

        <form.Field name="password">
          {(field) => (
            <Input
              label={t('adminUsers.create.fields.password')}
              id="new-password"
              name={field.name}
              type="password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={translateValidationError(t, firstError(field.state.meta.errors))}
              helpText={t('adminUsers.create.fields.passwordHelp')}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <div className={cx('byline-user-create-flags', styles.flags)}>
          <form.Field name="is_enabled">
            {(field) => (
              <Checkbox
                id="new-is-enabled"
                name={field.name}
                label={t('adminUsers.create.flags.enabledLabel')}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                helpText={t('adminUsers.create.flags.enabledHelp')}
              />
            )}
          </form.Field>

          <form.Field name="is_email_verified">
            {(field) => (
              <Checkbox
                id="new-is-email-verified"
                name={field.name}
                label={t('adminUsers.create.flags.emailVerifiedLabel')}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                helpText={t('adminUsers.create.flags.emailVerifiedHelp')}
              />
            )}
          </form.Field>

          <form.Field name="is_super_admin">
            {(field) => (
              <Checkbox
                id="new-is-super-admin"
                name={field.name}
                label={t('adminUsers.create.flags.superAdminLabel')}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                helpText={t('adminUsers.create.flags.superAdminHelp')}
              />
            )}
          </form.Field>
        </div>

        <div className={cx('byline-user-create-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-user-create-action', styles.action)}
          >
            {t('common.actions.cancel')}
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                size="sm"
                intent="primary"
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className={cx('byline-user-create-action', styles.action)}
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
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; cause?: unknown }
    if (typeof e.code === 'string') return e.code
    if (e.cause && typeof e.cause === 'object' && 'code' in e.cause) {
      const cause = e.cause as { code?: unknown }
      if (typeof cause.code === 'string') return cause.code
    }
  }
  return null
}
