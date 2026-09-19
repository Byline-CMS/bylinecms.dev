/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Site footer for the public frontend. The organisation name in the
 * copyright line is fictitious — this is a demonstration site — but every
 * link here resolves to a route or an external page that actually exists.
 * A mock-up full of dead links teaches the wrong thing about the shape of
 * an installation.
 *
 * Rendered once by `FrontendLayout`, below `<main>`, so it appears on every
 * public page rather than only the home page.
 */

import { Container, GithubIcon } from '@byline/ui/react'

import { routes } from '~/public'

import { useTranslations } from '@/i18n/client/translations-provider'
import { LangLink } from '@/i18n/components/lang-link'
import Logo from '@/images/byline-logo'
import type { Translations } from '@/i18n/translations'

const REPO = 'https://github.com/Byline-CMS/bylinecms.dev'

type LabelKey = keyof Translations['frontend']

interface FooterLink {
  labelKey: LabelKey
  /** Internal route — locale-aware through `LangLink`. */
  to?: string
  /** External URL — plain anchor, opened in a new tab. */
  href?: string
}

const columns: ReadonlyArray<{ headingKey: LabelKey; links: ReadonlyArray<FooterLink> }> = [
  {
    headingKey: 'footerSite',
    links: [
      { labelKey: 'navHome', to: '/' },
      { labelKey: 'navDocs', to: '/docs' },
      { labelKey: 'navNews', to: '/news' },
      { labelKey: 'navAbout', to: '/about-byline' },
    ],
  },
  {
    headingKey: 'footerResources',
    links: [
      { labelKey: 'docsTitle', to: '/docs' },
      { labelKey: 'footerGettingStarted', to: '/docs/getting-started' },
      { labelKey: 'footerAdmin', to: routes.admin },
    ],
  },
  {
    headingKey: 'footerProject',
    links: [
      { labelKey: 'viewOnGitHub', href: REPO },
      { labelKey: 'footerDiscussions', href: `${REPO}/discussions` },
      { labelKey: 'footerIssues', href: `${REPO}/issues` },
      { labelKey: 'footerLicense', href: `${REPO}/blob/main/LICENSE` },
    ],
  },
]

const linkClasses =
  'text-sm text-gray-700 no-underline transition-colors hover:text-gray-950 hover:underline dark:text-gray-400 dark:hover:text-gray-100'

export function SiteFooter() {
  const { t } = useTranslations('frontend')
  const year = String(new Date().getFullYear())

  return (
    <footer className="mt-auto border-t border-gray-900/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-canvas-900/40">
      <Container className="px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <LangLink to="/" className="mb-3 flex items-center gap-3 no-underline text-inherit">
              <Logo className="h-[26px] w-[26px]" />
              <span className="whitespace-nowrap text-[1.25rem] font-bold">Byline</span>
            </LangLink>
            <p className="m-0 text-sm leading-relaxed text-gray-700 dark:text-gray-400">
              {t('footerBlurb')}
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.headingKey} aria-label={t(column.headingKey)}>
              <h2 className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-600 dark:text-gray-400">
                {t(column.headingKey)}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {column.links.map((link) => (
                  <li key={link.labelKey} className="m-0 p-0">
                    {link.to != null ? (
                      <LangLink to={link.to} className={linkClasses}>
                        {t(link.labelKey)}
                      </LangLink>
                    ) : (
                      <a href={link.href} target="_blank" rel="noreferrer" className={linkClasses}>
                        {t(link.labelKey)}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-3 border-t border-gray-900/10 pt-6 text-sm text-gray-600 dark:border-white/10 dark:text-gray-400 sm:flex-row sm:justify-between">
          <p className="m-0">{t('footerCopyright', { year })}</p>
          {/* A div, not a p: `GithubIcon` renders a wrapping div, which is
              invalid inside a paragraph and breaks hydration. */}
          <div className="m-0 flex items-center gap-2">
            <span>{t('footerBuiltWith')}</span>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              aria-label={t('viewOnGitHub')}
              className="flex items-center"
            >
              <GithubIcon width="20px" height="20px" />
            </a>
          </div>
        </div>
      </Container>
    </footer>
  )
}
