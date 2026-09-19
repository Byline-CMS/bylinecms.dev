/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared heading for the home page's sections — a small uppercase kicker
 * flanked by the brand gradient rule, a title, and an optional lead.
 *
 * Kept local to `modules/home` on purpose: it is a home-page composition
 * detail, not a site-wide primitive. If a second area of the frontend ever
 * needs the same treatment, promote it to `ui/components` then.
 */

import type React from 'react'

interface SectionHeaderProps {
  kicker: string
  title: string
  intro?: string
  align?: 'center' | 'left'
  /** Optional trailing affordance (a "view all" link, for example). */
  action?: React.ReactNode
}

const GRADIENT_RULE = 'h-px w-8 bg-gradient-to-r from-purple-400 via-pink-500 to-amber-500'

export function SectionHeader({
  kicker,
  title,
  intro,
  align = 'center',
  action,
}: SectionHeaderProps) {
  const centered = align === 'center'

  return (
    <div
      className={
        centered
          ? 'mb-10 text-center sm:mb-14'
          : 'mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between'
      }
    >
      <div>
        <p
          className={`m-0 mb-3 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] text-gray-600 dark:text-gray-400 ${
            centered ? 'justify-center' : ''
          }`}
        >
          <span className={GRADIENT_RULE} aria-hidden="true" />
          {kicker}
          {centered ? <span className={GRADIENT_RULE} aria-hidden="true" /> : null}
        </p>
        <h2 className="m-0 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {intro != null ? (
          <p
            className={`mt-4 mb-0 max-w-2xl text-balance text-lg text-gray-700 dark:text-gray-300 ${
              centered ? 'mx-auto' : ''
            }`}
          >
            {intro}
          </p>
        ) : null}
      </div>
      {action != null ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
