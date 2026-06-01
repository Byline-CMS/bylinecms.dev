import type React from 'react'

import cx from 'classnames'

import { LangLink } from '@/i18n/components/lang-link'
import logoBlack from '@/images/byline-typelogo-dark.svg'
import logoWhite from '@/images/byline-typelogo-light.svg'
import type { Locale } from '@/i18n/i18n-config'

export function Branding({
  lng,
  hasScrolled,
  pathName,
}: {
  lng: Locale
  hasScrolled: boolean
  pathName: string
}): React.JSX.Element {
  const brandingBackground =
    hasScrolled || pathName.length > 3 ? 'bg-transparent' : 'bg-transparent'

  return (
    <div
      className={cx(
        'branding flex items-center pr-2 sm:pr-12 transition-colors duration-300',
        brandingBackground
      )}
    >
      <div className="w-[110px] sm:w-[110px]">
        <LangLink to="/" lng={lng} aria-label="Byline CMS">
          <img src={logoWhite} className="hidden dark:block" width={110} alt="Byline CMS" />
          <img src={logoBlack} className="block dark:hidden" width={110} alt="Byline CMS" />
        </LangLink>
      </div>
    </div>
  )
}
