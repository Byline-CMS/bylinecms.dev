import type React from 'react'
import { Link } from '@tanstack/react-router'

import cx from 'classnames'

import Logo from '@/images/byline-logo'
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
        'branding flex items-center pl-2 sm:pl-6 pr-2 sm:pr-12 transition-colors duration-300',
        brandingBackground
      )}
    >
      <Link to="/" className="flex items-center gap-3">
        <Logo className="w-[29px] h-[29px]" />
        <span className="text-[1.4rem] font-bold whitespace-nowrap">Byline</span>
      </Link>
    </div>
  )
}
