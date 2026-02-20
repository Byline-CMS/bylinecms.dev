'use client'

import { forwardRef, useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { GithubIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { Branding } from '@/modules/home/branding'
import { ThemeSwitch } from '@/ui/theme/theme-switch'
import type { Locale } from '@/i18n/i18n-config'

interface AppBarProps {
  className?: string
  lng: Locale
}
export type Ref = HTMLDivElement

export const AppBar = forwardRef<Ref, AppBarProps>(function AppBar(
  { className, lng, ...other },
  ref
) {
  const location = useRouterState({ select: (s) => s.location })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)

  const _handleToggleMobileMenu = (event: React.MouseEvent<HTMLButtonElement> | null): void => {
    if (event != null) event.stopPropagation()
    // e.preventDefault()
    setMobileMenuOpen(!mobileMenuOpen)
  }

  const _handleMobileMenuClose = (): void => {
    setMobileMenuOpen(false)
  }

  const handleWindowClick = (): void => {
    setMobileMenuOpen(false)
  }

  useEffect(() => {
    window.addEventListener('click', handleWindowClick)
    return () => {
      window.removeEventListener('click', handleWindowClick)
    }
  })

  const handleScroll = (): void => {
    const position = window.scrollY
    if (position > 100) {
      setHasScrolled(true)
    } else {
      setHasScrolled(false)
    }
  }

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  })

  const appBarBackground = hasScrolled
    ? 'bg-white dark:bg-canvas-900 border-b border-gray-200/50 dark:border-gray-900/70'
    : 'bg-transparent  backdrop-blur-md'
  // const appBarBackground =
  //   hasScrolled || pathName.length > 3
  //     ? 'bg-primary-400 dark:bg-primary-900'
  //     : 'border-b border-gray-800/50 bg-white dark:bg-black/80 backdrop-blur-md'

  const _appBarTextColor =
    hasScrolled || location.pathname.length > 3
      ? 'text-black fill-black dark:text-white dark:fill-white'
      : 'text-black fill-black dark:text-white dark:fill-white'

  const _hamburgerColor =
    hasScrolled || location.pathname.length > 3
      ? 'bg-black before:bg-black after:bg-black dark:bg-white dark:before:bg-white dark:after:bg-white'
      : 'bg-white before:bg-white after:bg-white'

  const _hamburgerColorMobileMenuOpen = 'bg-white before:bg-white after:bg-white'

  return (
    <header
      id="header"
      className={cx('sticky top-0 z-30 w-full', appBarBackground, className)}
      ref={ref}
      {...other}
    >
      <div
        id="app-bar"
        className={cx(
          'app-bar sticky top-0 flex min-h-[60px] w-full items-center gap-4 pl-0 pr-[12px]',
          'sm:gap-4 sm:pl-0 sm:pr-[18px]',
          'transition-all duration-500 ease-out'
        )}
      >
        <div className="lg:flex-initial mr-auto">
          <Branding lng="en" hasScrolled={hasScrolled} pathName={location.pathname} />
        </div>
        {/* <LanguageMenu lng={lng} color={appBarTextColor} /> */}
        <ThemeSwitch className="mr-2" />
        <a
          className="block"
          href="https://github.com/Byline-CMS/bylinecms.dev"
          target="_blank"
          rel="noreferrer"
        >
          <GithubIcon width="28px" height="28px" />
        </a>
      </div>
    </header>
  )
})
