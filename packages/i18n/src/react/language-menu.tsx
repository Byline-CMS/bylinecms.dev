/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-contained language switcher. Reads `localeDefinitions`,
 * `activeLocale`, and `setLocale` from `<I18nProvider>`'s context —
 * the host wires the actual server fn (and admin-user update) behind
 * `setLocale`; this component is pure UI.
 *
 * Renders nothing when fewer than two locales are configured, since
 * the affordance has nothing to switch between.
 *
 * Host adapters typically mount this in the admin chrome top bar. It
 * can also be embedded inside Account preferences (`<LanguageMenu />`
 * with no className override) or anywhere else the menu makes sense.
 */

import { useContext, useState } from 'react'

import { CheckIcon, Dropdown as DropdownMenu, GlobeIcon } from '@byline/ui/react'
import cx from 'classnames'

import { I18nContext } from './i18n-context.js'
import type { LocaleCode } from '../types.js'

export interface LanguageMenuProps {
  className?: string
  /** Tailwind / CSS class applied to the icon + label colour. */
  color?: string
  /** Render the menu disabled (loading, no `setLocale`, etc.). */
  disabled?: boolean
}

export function LanguageMenu({ className, color, disabled }: LanguageMenuProps) {
  const context = useContext(I18nContext)
  const [busy, setBusy] = useState(false)

  if (context == null) {
    throw new Error(
      '[@byline/i18n] <LanguageMenu> must be used inside <I18nProvider>. Mount the provider in your admin shell root.'
    )
  }

  const { activeLocale, localeDefinitions, setLocale } = context

  if (localeDefinitions.length < 2) return null

  const active = localeDefinitions.find((d) => d.code === activeLocale)
  const isDisabled = disabled || setLocale == null || busy

  const handleSelect = async (next: LocaleCode) => {
    if (next === activeLocale || setLocale == null || busy) return
    setBusy(true)
    try {
      await setLocale(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          render={
            <button
              type="button"
              aria-label={active?.nativeName ?? activeLocale}
              disabled={isDisabled}
              className="component--byline-language-menu rounded flex items-center justify-between gap-1 outline-none disabled:opacity-50"
            />
          }
        >
          <GlobeIcon svgClassName={color} />
          <span className={cx(color, 'hidden sm:inline mr-[4px]')}>
            {active?.nativeName ?? activeLocale}
          </span>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="center"
            sideOffset={10}
            className={cx(
              'z-40 rounded radix-side-bottom:animate-slide-down radix-side-top:animate-slide-up',
              'w-32 px-1.5 py-1 shadow-md',
              'bg-white dark:bg-canvas-800 border dark:border-canvas-700 shadow'
            )}
          >
            {localeDefinitions.map((def) => {
              const isActive = def.code === activeLocale
              return (
                <DropdownMenu.Item key={def.code} onClick={() => handleSelect(def.code)}>
                  <div className="flex">
                    <span className="inline-block w-[22px]">
                      {isActive && <CheckIcon width="18px" height="18px" />}
                    </span>
                    <span className="text-left inline-block w-full flex-1 self-start text-black dark:text-gray-300">
                      {def.nativeName}
                    </span>
                  </div>
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
