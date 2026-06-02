import type React from 'react'

import { CheckIcon } from '@byline/ui/react'
import cx from 'classnames'

import { contentLocales } from '~/locales'

import { useTranslations } from '@/i18n/client/translations-provider'
import { useLocale, useLocaleNavigation } from '@/i18n/hooks/use-locale-navigation'
import type { LanguageMap } from '@/i18n/language-map'
import type { RoutableLocale } from '../i18n-config'

// Content-locale labels, derived from Byline's single source of truth
// (`byline/locales.ts` → contentLocales) rather than a parallel map. The
// host authors the labels there (`Français`, not CLDR's `français`); the
// server-side consumers (sitemap / getMeta) read the same set via
// `getServerConfig().i18n.content.localeDefinitions`.
const languageMap: LanguageMap = Object.fromEntries(
  contentLocales.map((l) => [l.code, { nativeName: l.label }])
)

/**
 * Per-page "Also available in…" content-locale switcher.
 *
 * Driven by the document's **advertised** locale set — the
 * `availableLocales ∩ _availableVersionLocales` intersection produced by
 * `advertisedLocalesFor(doc)` in `src/lib/alternates.ts`. Callers pass that
 * resolved set (a plain `string[]`), so the visible switcher derives from the
 * exact same source as the `hreflang` meta and can never drift from it.
 *
 * Renders nothing unless the document advertises more than one locale — a
 * single advertised locale needs no switcher, and a locale-agnostic document
 * (empty advertised set) shows no affordance at all. See docs/I18N.md.
 */
export function AvailableLanguages({
  advertisedLocales,
  className,
}: {
  advertisedLocales: readonly string[]
  className?: string
}): React.JSX.Element | null {
  const currentLocale = useLocale()
  const { switchContentLocale } = useLocaleNavigation()
  const { t } = useTranslations('frontend')

  const handleOnClick = (requestedLocale: string) => () => {
    // Switch the content locale on the current page — same document, only the
    // locale prefix changes. The hook strips/rebuilds the path and applies the
    // (non-sticky) content-locale cookie rule.
    switchContentLocale(requestedLocale as RoutableLocale)
  }

  if (advertisedLocales.length <= 1) return null

  return (
    <div className="flex gap-2 flex-wrap items-center mb-2 mt-1">
      <div className="text-[0.9rem] m-0">{t('availableLanguages')}</div>
      <div className={cx('not-prose flex flex-wrap gap-2 items-center justify-start', className)}>
        {advertisedLocales.map((locale) => {
          const active = locale === currentLocale
          return (
            <button
              type="button"
              aria-label={`select language ${locale}`}
              tabIndex={0}
              key={locale}
              onClick={handleOnClick(locale)}
              className={cx(
                'flex flex-row gap-1 items-center justify-center text-[0.8rem] rounded border min-w-[70px] py-[2px] px-[5px]',
                'bg-gray-50/50 border-gray-100 hover:bg-gray-50 dark:bg-canvas-600/40 dark:hover:bg-canvas-600 dark:border-canvas-600',
                active ? 'text-left' : 'text-center'
              )}
            >
              {active && (
                <span>
                  <CheckIcon
                    width="18px"
                    height="18px"
                    svgClassName="fill-green-600 dark:fill-green-600"
                  />
                </span>
              )}
              <span className="inline-block w-full flex-1 text-black whitespace-nowrap dark:text-gray-100 leading-[1.4]">
                {languageMap[locale]?.nativeName}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
