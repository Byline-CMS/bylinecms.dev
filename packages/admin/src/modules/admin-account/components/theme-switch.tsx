'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Inline colour-theme switch for the account "Appearance" card — a
 * three-way segmented control (Light / Dark / System). Unlike the other
 * account sections it edits in place rather than through the drawer, so
 * there's no pencil affordance on its card. See `./theme.ts` for the
 * host theme contract this reads and writes.
 */

import { useEffect, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { ButtonGroup, ButtonGroupItem } from '@byline/ui/react'
import cx from 'classnames'

import { getThemeMode, setThemeMode, type ThemeMode } from './theme.js'
import styles from './theme-switch.module.css'

export function ThemeSwitch() {
  const { t } = useTranslation('byline-admin')

  // SSR and the first client render both show 'system' — a deterministic
  // value, so there's no hydration mismatch. The actual stored mode is
  // read once after mount (localStorage is client-only).
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    setMode(getThemeMode())
  }, [])

  const handleChange = (value: string | string[]) => {
    // `ButtonGroup`'s union props type the callback as `string | string[]`;
    // in single-select mode it's a string. A single-select ToggleGroup
    // also emits '' when the active item is re-clicked (deselect) — a
    // theme is always set, so ignore anything that isn't a known mode.
    const next = Array.isArray(value) ? value[0] : value
    if (next !== 'light' && next !== 'dark' && next !== 'system') return
    setMode(next)
    setThemeMode(next)
  }

  return (
    <div className={cx('byline-account-theme-switch', styles.wrap)}>
      <ButtonGroup
        type="single"
        size="sm"
        expandToFit
        value={mode}
        onValueChange={handleChange}
        aria-label={t('account.appearance.colorTheme')}
        className={cx('byline-account-theme-group', styles.group)}
      >
        <ButtonGroupItem value="light">{t('account.appearance.light')}</ButtonGroupItem>
        <ButtonGroupItem value="dark">{t('account.appearance.dark')}</ButtonGroupItem>
        <ButtonGroupItem value="system">{t('account.appearance.system')}</ButtonGroupItem>
      </ButtonGroup>
      <p className={cx('muted', 'byline-account-theme-help', styles.help)}>
        {t('account.appearance.help')}
      </p>
    </div>
  )
}
