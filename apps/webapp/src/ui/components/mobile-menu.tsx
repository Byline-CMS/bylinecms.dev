import { useLocation } from '@tanstack/react-router'

import { Accordion, Button, ChevronDownIcon, HomeIcon } from '@byline/ui/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { useLocaleNavigation } from '@/i18n/hooks/use-locale-navigation'
import { t } from '@/i18n/migrate-t'
import { pathWithoutLocale } from '@/i18n/utils'
import logoBlack from '@/images/byline-typelogo-dark.svg'
import logoWhite from '@/images/byline-typelogo-light.svg'
import { LangLink } from '../../i18n/components/lang-link'
import type { Locale } from '@/i18n/i18n-config'

import './mobile-menu.css'

interface MenuItem {
  title: string
  path: string
  target?: string
  children: MenuItem[] | null
}

const menuItems: MenuItem[] = [
  {
    title: 'Docs',
    path: '/docs',
    children: null,
  },
  {
    title: 'News',
    path: '/news',
    children: null,
  },
  {
    title: 'About',
    path: '/about-byline',
    children: null,
  },
]

interface MobileMenuProps {
  open: boolean
  lng: Locale
  onClose: () => void
  joinRef?: any
}

function getActive(pathname: string, path: string): boolean {
  const withoutLocale = pathWithoutLocale(pathname)
  if (path === '/') {
    return withoutLocale === path
  }
  return withoutLocale.startsWith(path)
}

export function MobileMenu({
  open,
  lng,
  onClose,
  joinRef,
  ...other
}: MobileMenuProps): React.JSX.Element {
  const { navigate } = useLocaleNavigation()
  const pathname = useLocation({ select: (loc) => loc.pathname })

  const handleMenuItemClick =
    (href: string | null) =>
    (event: any): void => {
      if (
        event != null &&
        event.type === 'keydown' &&
        (event.key === 'Tab' || event.key === 'Shift')
      ) {
        return
      }
      if (onClose != null) onClose()
      if (href != null) navigate({ to: href, locale: lng })
    }

  const handlers = useSwipeable({
    onSwipedRight: () => {
      if (onClose != null) onClose()
    },
  })

  return (
    <div
      id="mobile-menu"
      {...other}
      {...handlers}
      className={cx(
        'fixed right-0 top-0 z-20 h-screen w-full overflow-hidden md:w-[50%]',
        'bg-white dark:bg-canvas-800',
        'transition-transform duration-200 ease-linear ',
        { 'translate-x-[100%]': !open },
        { 'translate-x-[0%]': open }
      )}
    >
      <div className="mt-[4vh] mx-4">
        <div className="branding ml-4 mb-2">
          <LangLink to="/" lng={lng}>
            <img src={logoBlack} width={120} alt="Byline CMS" className="block dark:hidden" />
            <img src={logoWhite} width={120} alt="Byline CMS" className="hidden dark:block" />
          </LangLink>
        </div>
        <Accordion.Root render={<div className="component--scroller max-h-[80vh]" />}>
          <ul className="list-none px-3 pt-0 pb-6 mt-4">
            <Accordion.Item value="home" render={<li className="m-0 mb-1 p-0" />}>
              <Accordion.Trigger
                render={
                  <button
                    type="button"
                    className="mobile-menu-button"
                    onClick={handleMenuItemClick('/')}
                  />
                }
              >
                <HomeIcon className="mb-[-1px]" />
                &nbsp;
                <span>{t('Home')}</span>
              </Accordion.Trigger>
            </Accordion.Item>

            {menuItems?.map((item: MenuItem) => (
              <Accordion.Item
                key={item?.path}
                value={item?.path}
                render={<li className="m-0 mb-1 p-0" />}
              >
                {item?.children != null && item?.children?.length > 0 ? (
                  <Accordion.Trigger
                    render={
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                        }}
                        lang={lng}
                        className={cx('mobile-menu-button', {
                          active: getActive(pathname, item.path),
                        })}
                      />
                    }
                  >
                    {t(item.title)}
                    <ChevronDownIcon
                      width="25px"
                      height="25px"
                      className="ml-auto -rotate-90 text-violet10 ease-[cubic-bezier(0.87,_0,_0.13,_1)] transition-transform duration-300 group-data-[state=open]:rotate-0"
                      aria-hidden
                    />
                  </Accordion.Trigger>
                ) : item?.target === '_blank' ? (
                  <Accordion.Trigger
                    nativeButton={false}
                    render={
                      // biome-ignore lint/a11y/useAnchorContent: render-prop pattern — Accordion.Trigger clones the <a> and injects its own children
                      <a
                        href={item.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cx('mobile-menu-button', {
                          active: getActive(pathname, item.path),
                        })}
                        onClick={onClose}
                      />
                    }
                  >
                    {t(item.title)}
                  </Accordion.Trigger>
                ) : (
                  <Accordion.Trigger
                    render={
                      <button
                        type="button"
                        className={cx('mobile-menu-button', {
                          active: getActive(pathname, item.path),
                        })}
                        onClick={handleMenuItemClick(item.path)}
                      />
                    }
                  >
                    {t(item.title)}
                  </Accordion.Trigger>
                )}
                {item?.children != null && item?.children?.length > 0 && (
                  <Accordion.Panel>
                    <ul className="list-none m-0 mt-2 ml-[10px] mb-1 p-0 border-l border-white dark:border-slate-600">
                      {item.children.map((child) => (
                        <li key={child.path} className="m-0 mb-1 p-0 pl-[8px]">
                          <button
                            type="button"
                            className={cx('mobile-menu-button--child', {
                              active: pathWithoutLocale(pathname) === child.path,
                            })}
                            onClick={handleMenuItemClick(child?.path)}
                          >
                            {t(child.title)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Accordion.Panel>
                )}
              </Accordion.Item>
            ))}
          </ul>
        </Accordion.Root>
        {/* CTAs */}
        <div className="flex flex-col gap-4 max-w-[300px] mx-auto mt-6">
          <Button
            render={
              // biome-ignore lint/a11y/useAnchorContent: render-prop pattern — Button clones the <a> and injects its own children
              <a
                href="https://github.com/Byline-CMS/bylinecms.dev"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto"
          >
            View on GitHub
          </Button>
        </div>
      </div>
    </div>
  )
}
