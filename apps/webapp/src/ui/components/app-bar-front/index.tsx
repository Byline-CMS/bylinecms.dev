import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'

import { GithubIcon, Hamburger } from '@byline/ui/react'
import cx from 'classnames'

import { LanguageMenu } from '@/i18n/components/language-menu'
import { routableLocales } from '@/i18n/i18n-config'
import { DocsDrawerToggle } from '@/modules/docs/components/drawer-toggle'
import { MainMenu } from '@/ui/components/main-menu'
import { MobileMenu } from '@/ui/components/mobile-menu'
import { ThemeSwitch } from '@/ui/theme/theme-switch'
import { Branding } from './branding'
import type { Locale } from '@/i18n/i18n-config'

// Match `/docs` and `/docs/*` with or without a leading routable-locale
// segment (e.g. `/en/docs`, `/es/docs/getting-started`, `/de/docs`).
// Anchored so paths like `/somethingdocs` don't trigger.
const DOCS_PATH_RE = new RegExp(`^(?:/(?:${routableLocales.join('|')}))?/docs(?:/|$)`)

interface AppBarFrontProps {
  className?: string
  lng: Locale
  ref?: React.Ref<HTMLDivElement>
}

export const AppBarFront = ({ className, lng, ref, ...other }: AppBarFrontProps) => {
  const pathName = useLocation({ select: (loc) => loc.pathname })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [lastScrollY, setLastScrollY] = useState(0)
  const [_hasScrolledDown, setHasScrolledDown] = useState(false)

  const SCROLL_THRESHOLD = 50 // Minimum distance to trigger show/hide logic

  const handleToggleMobileMenu = (open: boolean): void => {
    setMobileMenuOpen(open)
  }

  const handleMobileMenuClose = (): void => {
    setMobileMenuOpen(false)
  }

  const handleWindowClick = (): void => {
    setMobileMenuOpen(false)
  }

  const handleScroll = (): void => {
    const currentScrollY = window.scrollY
    // Check if scroll distance exceeds the threshold
    if (Math.abs(currentScrollY - lastScrollY) > SCROLL_THRESHOLD) {
      if (currentScrollY > lastScrollY && currentScrollY > 0) {
        // User scrolled down
        setHasScrolledDown(true)
      } else {
        // User scrolled up
        setHasScrolledDown(false)
      }
      setLastScrollY(currentScrollY) // Update lastScrollY after logic
    }

    // TODO - refine for correct locale detection
    // For now home / and anything with a two character path
    if (pathName.length <= 3) {
      const position = window.scrollY
      if (position > 100) {
        setHasScrolled(true)
      } else {
        setHasScrolled(false)
      }
    }
  }

  useEffect(() => {
    window.addEventListener('click', handleWindowClick)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('click', handleWindowClick)
      window.removeEventListener('scroll', handleScroll)
    }
  })

  // const appBarBackground =
  //   hasScrolled || pathName.length > 3
  //     ? 'bg-white dark:bg-primary-900'
  //     : 'bg-transparent dark:bg-transparent'

  const appBarBackground =
    hasScrolled || pathName.length > 3
      ? 'bg-white/70 dark:bg-canvas-900/60 backdrop-blur-md backdrop-saturate-150 shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)]'
      : 'bg-transparent dark:bg-transparent'

  const appBarTextColor =
    hasScrolled || pathName.length > 3
      ? 'text-black fill-black dark:text-white dark:fill-white'
      : 'text-black fill-black dark:text-white dark:fill-white'

  const _hamburgerColor =
    'bg-black before:bg-black after:bg-black dark:bg-white dark:before:bg-white dark:after:bg-white'

  return (
    <header className={cx('w-full sticky top-0 z-50 isolate', className)} ref={ref} {...other}>
      {/* Fix for background blur and mobile devices where background effects break sticky above. */}
      <div
        className={cx(
          'pointer-events-none absolute inset-0 -z-10 transition-colors duration-300',
          appBarBackground
        )}
      />
      <div
        className={cx(
          'app-bar flex h-[50px] w-full items-center gap-2 pl-0 pr-[12px]',
          'sm:gap-2 sm:pl-0 sm:pr-[18px]',
          'transition-all duration-500 ease-out'
        )}
      >
        <div className="lg:flex-initial mr-auto flex items-center gap-2 pl-3">
          {DOCS_PATH_RE.test(pathName) ? <DocsDrawerToggle /> : null}
          <Branding lng={lng} hasScrolled={hasScrolled} pathName={pathName} />
        </div>
        <MainMenu lng={lng} color={appBarTextColor} />
        <div className="flex items-center gap-2 lg:gap-4 ml-auto">
          <LanguageMenu lng={lng} color={appBarTextColor} />
          <ThemeSwitch />
          <a
            className="block"
            href="https://github.com/Byline-CMS/bylinecms.dev"
            target="_blank"
            rel="noreferrer"
            aria-label="View Byline CMS on GitHub"
          >
            <GithubIcon width="28px" height="28px" />
          </a>
          <div className="lg:hidden">
            <Hamburger open={mobileMenuOpen} onChange={handleToggleMobileMenu} />
          </div>
          <MobileMenu lng={lng} open={mobileMenuOpen} onClose={handleMobileMenuClose} />
        </div>
      </div>
    </header>
  )
}
