'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service Preferences form.
 *
 * General-purpose container for the signed-in admin's UI preferences.
 * Today the only setting is the interface locale; future preferences
 * (theme, default landing page, density, etc.) land here as additional
 * `<form.Field>` blocks rather than spinning up a new drawer per
 * setting.
 *
 * Locale write surface mirrors the chrome-bar `<LanguageMenu>` — both
 * route through `setInterfaceLocale` (the service) →
 * `setInterfaceLocaleFn` (the host server fn) → the shared
 * cookie + `admin_users.preferred_locale` writes. The dropdown carries
 * an explicit "Use browser default" entry that maps to `null`
 * server-side, clearing the column and re-engaging the detection
 * cascade (cookie → Accept-Language → defaultLocale). The sentinel
 * value `__auto__` is the wire form for that option; the service
 * signature uses `string | null`.
 *
 * On save, the freshened `AccountResponse` returned by the server fn
 * is lifted into the parent container so the read-only Preferences
 * section re-renders without a route reload. Mirrors how
 * `UpdateAccount` threads its result through `onSuccess`.
 */

import { useMemo, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { getClientConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, LoaderEllipsis, Select } from '@byline/ui/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './preferences.module.css'
import type { AccountResponse } from '../index.js'

/**
 * Sentinel for the "Use browser default" entry in the locale select.
 * The widget's value type is `string`; we map this sentinel to `null`
 * at submit time. Prefixed with double-underscore to make collision
 * with a real BCP 47 tag structurally impossible (no real locale code
 * contains underscores).
 */
const AUTO_VALUE = '__auto__'

const preferencesSchema = z.object({
  // Validation against the configured locale set happens server-side
  // (it's the single source of truth). The form schema just enforces
  // non-emptiness — `AUTO_VALUE` is a valid selection.
  locale: z.string().min(1, { message: 'Select a language' }),
})

type PreferencesValues = z.infer<typeof preferencesSchema>

function defaultsFrom(account: AccountResponse): PreferencesValues {
  return { locale: account.preferred_locale ?? AUTO_VALUE }
}

interface PreferencesProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

export function Preferences({ account, onClose, onSuccess }: PreferencesProps) {
  const { t } = useTranslation('byline-admin')
  const { setInterfaceLocale } = useBylineAdminServices()
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Build the dropdown's items from the host's configured interface
  // locales. `localeDefinitions` carries host-authored display names
  // ("Français" vs CLDR's lowercase "français"); when it's not set,
  // fall back to the raw code so the form still functions.
  const localeItems = useMemo(() => {
    const { i18n } = getClientConfig()
    const definitionByCode = new Map(
      (i18n.interface.localeDefinitions ?? []).map((d) => [d.code, d.nativeName])
    )
    const items = i18n.interface.locales.map((code) => ({
      value: code,
      label: definitionByCode.get(code) ?? code,
    }))
    return [{ value: AUTO_VALUE, label: t('language.useBrowserDefault') }, ...items]
  }, [t])

  const form = useForm({
    defaultValues: defaultsFrom(account),
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: preferencesSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      const nextLocale = value.locale === AUTO_VALUE ? null : value.locale
      if (nextLocale === (account.preferred_locale ?? null)) {
        setSuccessMessage(t('common.feedback.noChanges'))
        return
      }
      try {
        const result = await setInterfaceLocale({ data: { locale: nextLocale } })
        // Pre-auth path returns `account: null`; the form is only
        // reachable behind an admin session, so `account` should be
        // populated. Treat absence as a defensive no-op.
        setSuccessMessage(t('common.feedback.saved'))
        if (result.account != null) {
          onSuccess?.(result.account)
        }
      } catch {
        setFormError(t('common.errors.couldNotSave'))
      }
    },
  })

  return (
    <div className={cx('byline-account-preferences-wrap', styles.wrap)}>
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-account-preferences-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <form.Field name="locale">
          {(field) => (
            <div className={cx('byline-account-preferences-row', styles.row)}>
              <label
                htmlFor="preferences-locale-select"
                className={cx('byline-account-preferences-label', styles.label)}
              >
                {t('account.preferences.languageLabel')}
              </label>
              <Select<string>
                id="preferences-locale-select"
                size="sm"
                ariaLabel={t('account.preferences.languageLabel')}
                value={field.state.value}
                items={localeItems}
                onValueChange={(value) => {
                  if (value != null) field.handleChange(value)
                }}
              />
              <p className={cx('muted', 'byline-account-preferences-help', styles.help)}>
                {t('account.preferences.languageHelp')}
              </p>
            </div>
          )}
        </form.Field>

        <div className={cx('byline-account-preferences-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-account-preferences-action', styles.action)}
          >
            {successMessage ? t('common.actions.close') : t('common.actions.cancel')}
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
                className={cx('byline-account-preferences-action', styles.action)}
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
