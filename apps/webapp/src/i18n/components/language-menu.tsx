import { CheckIcon, Dropdown as DropdownMenu, GlobeIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useLanguageSwitcher } from '@/i18n/hooks/use-language-switcher'
import { interfaceLanguageMap as languageMap } from '@/i18n/language-map'
import type { Locale } from '../i18n-config'

import './language-menu.css'

type LanguageMenuIntrinsicProps = React.JSX.IntrinsicElements['div']
interface LanguageMenuProps extends LanguageMenuIntrinsicProps {
  className?: string
  shiftMenu?: boolean
  color?: string
}

export function LanguageMenu({
  className,
  color,
  shiftMenu = true,
}: LanguageMenuProps): React.JSX.Element {
  const { switchLanguage, currentLocale } = useLanguageSwitcher()

  const handleOnSelect = (event: Event) => {
    const lng = (event.target as HTMLElement)?.dataset.language as Locale
    if (lng) switchLanguage(lng)
  }

  return (
    <div className={className}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={languageMap[currentLocale]?.nativeName}
            className="component--language-menu rounded flex items-center justify-between gap-1 outline-none"
          >
            <GlobeIcon svgClassName={color} />
            <span className={cx(color, 'hidden sm:inline mr-[4px]')}>
              {languageMap[currentLocale]?.nativeName}
            </span>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="center"
            sideOffset={shiftMenu ? 10 : 10}
            className={cx(
              'z-40 rounded radix-side-bottom:animate-slide-down radix-side-top:animate-slide-up',
              'w-28 px-1.5 py-1 shadow-md',
              'bg-white dark:bg-canvas-800 border dark:border-canvas-700 shadow'
            )}
          >
            {Object.keys(languageMap).map((language) => {
              const active = currentLocale === language
              return (
                <DropdownMenu.Item
                  key={language}
                  onSelect={handleOnSelect}
                  data-language={language}
                >
                  <div className="flex">
                    <span className="inline-block w-[22px]">
                      {active && <CheckIcon width="18px" height="18px" />}
                    </span>
                    <span className="text-left inline-block w-full flex-1 self-start text-black dark:text-gray-300">
                      {languageMap[language].nativeName}
                    </span>
                  </div>
                </DropdownMenu.Item>
              )
            })}
            {/* <div className="divider my-1 border-t border-t-gray-300 dark:border-t-gray-700 w-[90%] mx-auto"></div>
            <button
              tabIndex={0}
              className={cx(
                'settings w-full flex gap-1 select-none items-center pl-[3px] pr-[2px] py-[5px] text-sm outline-none',
                'text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-canvas-900'
              )}
            >
              <SettingsGearIcon svgClassName="stroke-black" width="15px" height="15px" />
              <span className="inline-block ml-[1px]">{t('Settings')}</span>
            </button> */}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
