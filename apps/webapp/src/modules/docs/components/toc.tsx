'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * "On this page" — the per-document contents navigator.
 *
 * `DocsTocList` is the shared list, used by both presentations: the sticky
 * right-hand rail on wide viewports (`DocsToc`), and the bottom sheet the rail
 * lifts into on narrow ones (`DocsTocSheet`). The headings themselves are
 * derived from the stored content in `@/modules/docs/toc`, so this component
 * only presents them.
 */

import type React from 'react'

import cx from 'classnames'

import styles from './toc.module.css'
import { useActiveHeading } from './use-active-heading'
import type { TocHeading } from '@/modules/docs/toc'

interface DocsTocListProps {
  headings: TocHeading[]
  activeId: string | null
  /** Fires after a heading is chosen — lets the sheet dismiss itself. */
  onNavigate?: () => void
}

export function DocsTocList({
  headings,
  activeId,
  onNavigate,
}: DocsTocListProps): React.JSX.Element {
  return (
    <ul className={cx('byline-docs-toc-list', styles.list)}>
      {headings.map((heading) => (
        <li key={heading.id} className={cx('byline-docs-toc-item', styles.item)}>
          <a
            href={`#${heading.id}`}
            aria-current={heading.id === activeId ? 'location' : undefined}
            className={cx('byline-docs-toc-link', styles.link, {
              'byline-docs-toc-link-h3': heading.level === 3,
              [styles.linkLevel3]: heading.level === 3,
              'byline-docs-toc-link-active': heading.id === activeId,
              [styles.linkActive]: heading.id === activeId,
            })}
            onClick={onNavigate}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  )
}

interface DocsTocProps {
  headings: TocHeading[]
  label: string
}

/**
 * The desktop rail. Renders nothing when the document has no headings — a page
 * of prose with no sections gets the full content width instead of an empty
 * column. The `<aside>` itself is hidden below the three-column breakpoint by
 * `toc.module.css`.
 */
export function DocsToc({ headings, label }: DocsTocProps): React.JSX.Element | null {
  const activeId = useActiveHeading(headings)

  if (headings.length === 0) return null

  return (
    <aside className={cx('byline-docs-toc-aside', styles.aside)}>
      <nav className={cx('byline-docs-toc', styles.nav)} aria-labelledby="byline-docs-toc-heading">
        <h2 id="byline-docs-toc-heading" className={cx('byline-docs-toc-heading', styles.heading)}>
          {label}
        </h2>
        <DocsTocList headings={headings} activeId={activeId} />
      </nav>
    </aside>
  )
}
