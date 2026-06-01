/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Top-level navigation menu rendered inside the AppBar. Hidden on
 * narrow viewports — desktop only for now. Routes through `<LangLink>`
 * so each item resolves to the current locale's URL automatically
 * (e.g. `/docs` for default locale, `/fr/docs` for French).
 */

import { useRouterState } from '@tanstack/react-router'

import cx from 'classnames'

import { useTranslations } from '@/i18n/client/translations-provider'
import { LangLink } from '@/i18n/components/lang-link'
import { i18nConfig } from '@/i18n/i18n-config'
import type { Translations } from '@/i18n/translations'

const items: ReadonlyArray<{ to: string; labelKey: keyof Translations['frontend'] }> = [
  { to: '/', labelKey: 'navHome' },
  { to: '/docs', labelKey: 'navDocs' },
  { to: '/news', labelKey: 'navNews' },
  { to: '/about-byline', labelKey: 'navAbout' },
]

function stripLocalePrefix(pathname: string): string {
  const firstSegment = pathname.split('/')[1] ?? ''
  if (i18nConfig.locales.includes(firstSegment as (typeof i18nConfig.locales)[number])) {
    const rest = pathname.slice(firstSegment.length + 1)
    return rest === '' ? '/' : rest
  }
  return pathname
}

function getActive(pathname: string, to: string): boolean {
  const stripped = stripLocalePrefix(pathname)
  if (to === '/') return stripped === '/'
  return stripped === to || stripped.startsWith(`${to}/`)
}

export function MainMenu({ color }: { color?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { t } = useTranslations('frontend')

  return (
    <nav aria-label="Main" className="hidden lg:flex flex-1 justify-center">
      <ul className="flex list-none gap-1 m-0 p-0">
        {items.map((item) => {
          const active = getActive(pathname, item.to)
          return (
            <li key={item.to}>
              <LangLink
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'block rounded px-3 py-2 text-[0.975rem] leading-none transition-colors duration-100',
                  'no-underline outline-none hover:font-medium',
                  active ? 'font-medium' : 'font-normal',
                  color
                )}
              >
                {t(item.labelKey)}
              </LangLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
