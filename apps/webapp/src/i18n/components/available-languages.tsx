import type React from 'react'

import { CheckIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useLocale, useLocaleNavigation } from '@/i18n/hooks/use-locale-navigation'
import { availableLanguageMap as languageMap } from '@/i18n/language-map'
import type { AvailableLanguagesType } from '@/i18n/language-map'
import type { Locale } from '../i18n-config'

function hasMoreThanOneLanguage(availableLanguages: AvailableLanguagesType): boolean {
  const keys = Object.keys(availableLanguages)
  let count = 0
  for (const key of keys) {
    if (availableLanguages[key as keyof object]) {
      count += 1
    }
  }
  return count > 1
}

export function AvailableLanguages({
  availableLanguages,
  className,
}: {
  availableLanguages: AvailableLanguagesType
  className?: string
}): React.JSX.Element | null {
  const currentLocale = useLocale()
  const { navigate } = useLocaleNavigation()

  const handleOnClick = (requestedLocale: string) => () => {
    // Navigate to the current path with the new locale.
    // The navigate function handles persisting the cookie when locale changes.
    navigate({ to: '.', locale: requestedLocale as Locale })
  }

  if (hasMoreThanOneLanguage(availableLanguages)) {
    const keys = Object.keys(availableLanguages)
    return (
      <div className={cx('not-prose flex gap-2 items-center justify-start mb-2', className)}>
        <span className="text-[0.9rem]">Language:</span>
        {keys.map((availableLanguage) => {
          if (availableLanguages[availableLanguage as keyof object]) {
            const active = availableLanguage === currentLocale
            return (
              <button
                type="button"
                aria-label={`select language ${availableLanguage}`}
                tabIndex={0}
                key={availableLanguage}
                onClick={handleOnClick(availableLanguage)}
                className={cx(
                  'flex flex-row gap-1 items-center justify-center text-[0.8rem] border min-w-[70px] py-[2px] px-[5px]',
                  'bg-gray-50 hover:bg-gray-100 dark:bg-canvas-400/50 dark:hover:bg-canvas-400 dark:border-canvas-400',
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
                <span className="inline-block w-full flex-1 text-black dark:text-gray-300 leading-[1.4]">
                  {languageMap[availableLanguage]?.nativeName}
                </span>
              </button>
            )
          } else {
            return null
          }
        })}
      </div>
    )
  } else {
    return null
  }
}
