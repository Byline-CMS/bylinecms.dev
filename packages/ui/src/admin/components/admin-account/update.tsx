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

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import type { AccountResponse } from '@byline/admin/admin-account'
import { Alert, Button, Input, LoaderEllipsis } from '@infonomic/uikit/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './update.module.css'

const updateAccountSchema = z.object({
  given_name: z.string().max(100, 'Given name must not exceed 100 characters'),
  family_name: z.string().max(100, 'Family name must not exceed 100 characters'),
  username: z.string().max(100, 'Username must not exceed 100 characters'),
  email: z
    .email({ message: 'Enter a valid email address' })
    .min(3)
    .max(254, 'Email must not exceed 254 characters'),
})

type UpdateAccountValues = z.infer<typeof updateAccountSchema>

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
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
        setSuccessMessage('No changes to save.')
        return
      }
      try {
        const updated = await updateAccount({ data: { vid: account.vid, patch } })
        setSuccessMessage('Saved.')
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.emailInUse') {
          form.setFieldMeta('email', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: 'This email is already in use.' },
            errors: ['This email is already in use.'],
          }))
          return
        }
        if (code === 'admin.users.versionConflict') {
          setFormError(
            'Your account has been modified elsewhere since you opened this form. Reload to refresh and try again.'
          )
          return
        }
        if (code === 'admin.account.notFound') {
          setFormError('Your admin account could not be found. Please sign in again.')
          return
        }
        setFormError('Could not save changes. Please try again.')
      }
    },
  })

  return (
    <div className={cx('byline-account-update-wrap', styles.wrap)}>
      <form
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
              label="Given name"
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
              label="Family name"
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
              label="Username"
              id="username"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText="Optional. Leave blank to clear."
              autoComplete="username"
            />
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Input
              label="Email"
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
            {successMessage ? 'Close' : 'Cancel'}
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
                {isSubmitting === true ? <LoaderEllipsis size={42} /> : 'Save'}
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
