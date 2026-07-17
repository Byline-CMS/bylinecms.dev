'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Prev / next spine tiles for a docs detail page — the GitBook / Docusaurus
 * pattern: two equal-width bordered tiles, "previous" pinned left and "next"
 * pinned right, each with a small direction eyebrow over the document title.
 *
 * The "spine" is the pre-order (depth-first) flatten of the document tree — the
 * linear reading order (docs/04-collections/04-document-trees.md); prev / next are the current
 * document's neighbours in it. The tree is already loaded by the docs layout
 * (`getDocsNavFn`), so this reads the parent route's loader data — no extra
 * fetch — and finds the neighbours by the current document's `chain`. Renders
 * nothing for a doc absent from the spine (e.g. an unplaced doc).
 *
 * Each tile carries the neighbour's title + canonical URL today; a future phase
 * may add summary text (the `.text` column already leaves room for it).
 */

import type React from 'react'
import { Link, useLoaderData } from '@tanstack/react-router'

import { ChevronLeftIcon, ChevronRightIcon } from '@byline/ui/react'
import cx from 'classnames'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import { type DocNavNode, flattenDocNav } from '@/modules/docs/nav'
import styles from './prev-next.module.css'
import type { Locale } from '@/i18n/i18n-config'

interface DocsPrevNextProps {
  /** The current document's canonical chain, e.g. `getting-started/cli`. */
  currentChain: string
  lng: Locale
}

export function DocsPrevNext({ currentChain, lng }: DocsPrevNextProps): React.JSX.Element | null {
  const { nodes } = useLoaderData({ from: '/$lng/_frontend/docs' })
  const { t } = useTranslations('frontend')

  const spine = flattenDocNav(nodes)
  const index = spine.findIndex((node) => node.chain.join('/') === currentChain)
  if (index === -1) return null

  const prev = index > 0 ? spine[index - 1] : null
  const next = index < spine.length - 1 ? spine[index + 1] : null
  if (prev == null && next == null) return null

  return (
    <nav className={cx('byline-docs-prevnext', styles.prevnext)} aria-label={t('docsPagination')}>
      <div className={styles.slot}>
        {prev != null && <Tile node={prev} lng={lng} direction="prev" label={t('docsPrevious')} />}
      </div>
      <div className={cx(styles.slot, styles.slotRight)}>
        {next != null && <Tile node={next} lng={lng} direction="next" label={t('docsNext')} />}
      </div>
    </nav>
  )
}

interface TileProps {
  node: DocNavNode
  lng: Locale
  direction: 'prev' | 'next'
  label: string
}

function Tile({ node, lng, direction, label }: TileProps): React.JSX.Element {
  const isNext = direction === 'next'
  return (
    <Link
      className={cx('byline-docs-prevnext-tile', styles.tile, isNext ? styles.next : styles.prev)}
      to="/$lng/docs/$"
      params={{ ...lngParam(lng), _splat: node.chain.join('/') }}
      rel={direction}
    >
      {!isNext && (
        <span className={styles.icon} aria-hidden="true">
          <ChevronLeftIcon width="18px" height="18px" />
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.dir}>{label}</span>
        <span className={styles.title}>{node.title}</span>
      </span>
      {isNext && (
        <span className={styles.icon} aria-hidden="true">
          <ChevronRightIcon width="18px" height="18px" />
        </span>
      )}
    </Link>
  )
}
