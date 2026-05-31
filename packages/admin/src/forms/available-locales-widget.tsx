'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useMemo } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Checkbox } from '@byline/ui/react'
import cx from 'classnames'

import { reconcileLocaleState } from './available-locales-reconcile'
import styles from './available-locales-widget.module.css'
import { useFormContext, useSystemAvailableLocales } from './form-context'

export { type ReconciledLocaleState, reconcileLocaleState } from './available-locales-reconcile'

/** A content locale to render a checkbox for. */
export interface AvailableLocalesWidgetLocale {
  code: string
  label: string
}

export interface AvailableLocalesWidgetProps {
  /** All configured content locales — one checkbox each (code + display label). */
  contentLocales: ReadonlyArray<AvailableLocalesWidgetLocale>
  /**
   * The saved version's ledger-complete locale set (`_availableVersionLocales`,
   * read-only structural fact). Drives the per-row intent. Empty until the read
   * surface supplies it (Slice 6) — in which case every row renders neutral.
   */
  availableVersionLocales: readonly string[]
}

/**
 * System-managed `availableLocales` widget — the editorial "advertise these
 * content locales" control. Renders one checkbox per content locale in the
 * sidebar, directly below the path widget. The checked state reflects the
 * stored advertised set (`useSystemAvailableLocales`); each row's intent
 * reconciles that against the structural ledger fact (`availableVersionLocales`)
 * via {@link reconcileLocaleState}. Opt-in: nothing is advertised until the
 * editor checks a (green) locale.
 *
 * Stable override handles: `.byline-form-available-locales`,
 * `.byline-form-available-locales-list`.
 */
export const AvailableLocalesWidget = ({
  contentLocales,
  availableVersionLocales,
}: AvailableLocalesWidgetProps) => {
  const { t } = useTranslation('byline-admin')
  const { setSystemAvailableLocales } = useFormContext()
  const advertised = useSystemAvailableLocales()

  const advertisedSet = useMemo(() => new Set(advertised), [advertised])
  const ledgerSet = useMemo(() => new Set(availableVersionLocales), [availableVersionLocales])

  const toggle = useCallback(
    (code: string, checked: boolean) => {
      const next = new Set(advertised)
      if (checked) {
        next.add(code)
      } else {
        next.delete(code)
      }
      setSystemAvailableLocales([...next])
    },
    [advertised, setSystemAvailableLocales]
  )

  if (contentLocales.length === 0) {
    return null
  }

  return (
    <div className={cx('byline-form-available-locales', styles.container)}>
      <span
        id="available-locales-label"
        className={cx('byline-form-available-locales-label', styles.label)}
      >
        {t('availableLocalesWidget.label')}
      </span>
      <div
        className={cx('byline-form-available-locales-list', styles.list)}
        role="group"
        aria-labelledby="available-locales-label"
        aria-describedby="available-locales-description"
      >
        {contentLocales.map(({ code, label }) => {
          const checked = advertisedSet.has(code)
          const { intent, disabled } = reconcileLocaleState(checked, ledgerSet.has(code))
          return (
            <Checkbox
              key={code}
              id={`available-locale-${code}`}
              name={`__availableLocale_${code}__`}
              label={label}
              intent={intent}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(value) => toggle(code, value === true)}
            />
          )
        })}
      </div>
      <span
        id="available-locales-description"
        className={cx('byline-form-available-locales-sr-only', styles['sr-only'])}
      >
        {t('availableLocalesWidget.srDescription')}
      </span>
    </div>
  )
}
