'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Dropdown, EllipsisIcon } from '@byline/ui/react'
import cx from 'classnames'

import { Link } from '../loose-router.js'
import styles from './breadcrumbs.module.css'
import type { Breadcrumb } from './@types.js'

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const MAX_LABEL_LENGTH = 20

function truncate(str: string, length: number, useWordBoundary = true, useSuffix = true): string {
  if (str == null || str.length <= length) return str
  const subString = str.slice(0, length - 2)
  const truncated = useWordBoundary ? subString.slice(0, subString.lastIndexOf(' ')) : subString
  return useSuffix ? `${truncated}...` : truncated
}

export function Breadcrumbs({
  breadcrumbs,
  className,
  homeLabel = 'Home',
  homePath = '/',
}: {
  breadcrumbs: Breadcrumb[]
  className?: string
  homeLabel?: string
  homePath?: string
}): React.JSX.Element {
  const navRef = useRef<HTMLElement | null>(null)
  const measureRef = useRef<HTMLUListElement | null>(null)
  // visibleIndices = indices into breadcrumbs[] that are shown inline.
  // Anything missing from this set is rolled into the overflow dropdown.
  // Default to "all visible" so SSR and pre-measurement paints look right.
  const [visibleIndices, setVisibleIndices] = useState<number[]>(() => breadcrumbs.map((_, i) => i))

  // Reset visibility when breadcrumbs change; the measurement effect below
  // will collapse again on the next layout tick if needed.
  useIsoLayoutEffect(() => {
    setVisibleIndices(breadcrumbs.map((_, i) => i))
  }, [breadcrumbs])

  useIsoLayoutEffect(() => {
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure) return

    const compute = () => {
      // measurement layer order: [home, ...breadcrumbs..., overflow-trigger]
      const children = Array.from(measure.children) as HTMLElement[]
      if (children.length !== breadcrumbs.length + 2) return

      const containerWidth = nav.clientWidth
      const homeWidth = children[0].offsetWidth
      const triggerWidth = children[children.length - 1].offsetWidth
      const itemWidths = children.slice(1, -1).map((el) => el.offsetWidth)
      const gap = Number.parseFloat(getComputedStyle(measure).gap) || 4

      const n = itemWidths.length
      let next: number[]

      // n <= 1: just Home + (optional) leaf — never collapse.
      // n === 2: per design, two-segment trails (Home > Dashboard > Leaf) never collapse.
      const allTotal = homeWidth + itemWidths.reduce((a, b) => a + b, 0) + n * gap
      if (n <= 2 || allTotal <= containerWidth) {
        next = itemWidths.map((_, i) => i)
      } else {
        // Always preserve Dashboard (idx 0) and Leaf (idx n-1).
        // Then add middle items greedily from leaf-adjacent backward.
        const visible = new Set<number>([0, n - 1])
        // Gap accounting: between home/dashboard, dashboard/trigger,
        // trigger/leaf, plus the leading gap before home.
        const baselineGaps = 4 * gap
        let used = homeWidth + itemWidths[0] + triggerWidth + itemWidths[n - 1] + baselineGaps

        if (used > containerWidth) {
          // Even Home + Dashboard + … + Leaf doesn't fit. Push Dashboard
          // into the overflow too; keep Home + … + Leaf as the minimum.
          visible.delete(0)
          used = homeWidth + triggerWidth + itemWidths[n - 1] + 3 * gap
        }

        for (let i = n - 2; i >= 1; i--) {
          if (visible.has(i)) continue
          const cost = itemWidths[i] + gap
          if (used + cost > containerWidth) break
          used += cost
          visible.add(i)
        }
        next = [...visible].sort((a, b) => a - b)
      }

      setVisibleIndices((prev) => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
        return next
      })
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [breadcrumbs])

  const overflowed = useMemo(() => {
    const visible = new Set(visibleIndices)
    return breadcrumbs.filter((_, i) => !visible.has(i))
  }, [breadcrumbs, visibleIndices])

  // Walk source order, emitting visible items inline; the first time we hit
  // an overflowed index, drop the dropdown trigger in its place.
  const visibleSet = new Set(visibleIndices)
  const lastIndex = breadcrumbs.length - 1
  let overflowEmitted = false
  const rendered: React.ReactNode[] = []
  for (let i = 0; i < breadcrumbs.length; i++) {
    if (visibleSet.has(i)) {
      rendered.push(renderBreadcrumb(breadcrumbs[i], i === lastIndex))
    } else if (!overflowEmitted) {
      overflowEmitted = true
      rendered.push(<OverflowDropdown key="__overflow__" items={overflowed} />)
    }
  }

  return (
    <nav
      ref={navRef}
      aria-label="Breadcrumb"
      className={cx('byline-breadcrumbs', styles.nav, className)}
    >
      <ul className={cx('byline-breadcrumbs-list', styles.list)}>
        <HomeItem homePath={homePath} homeLabel={homeLabel} />
        {rendered}
      </ul>
      {/* Hidden measurement layer — always renders every item plus the
          overflow trigger placeholder so we can read accurate widths. */}
      <ul ref={measureRef} aria-hidden className={cx(styles.list, styles.measure)}>
        <HomeItem homePath={homePath} homeLabel={homeLabel} />
        {breadcrumbs.map((b, i) => renderBreadcrumb(b, i === lastIndex))}
        <li className={cx('byline-breadcrumbs-item', styles.item)}>
          <ChevronIcon />
          <span className={cx('byline-breadcrumbs-overflow-trigger', styles.overflowTrigger)}>
            <EllipsisIcon className={cx('byline-breadcrumbs-overflow-icon', styles.overflowIcon)} />
          </span>
        </li>
      </ul>
    </nav>
  )
}

function renderBreadcrumb(breadcrumb: Breadcrumb, isLeaf: boolean): React.JSX.Element {
  return (
    <li
      key={breadcrumb.href}
      aria-current={isLeaf ? 'page' : undefined}
      className={cx('byline-breadcrumbs-item', styles.item)}
    >
      <ChevronIcon isLeaf={isLeaf} />
      {isLeaf ? (
        <span className={cx('byline-breadcrumbs-leaf', styles.leaf)}>
          {truncate(breadcrumb.label, MAX_LABEL_LENGTH, true)}
        </span>
      ) : (
        <Link to={breadcrumb.href as string} className={cx('byline-breadcrumbs-link', styles.link)}>
          {truncate(breadcrumb.label, MAX_LABEL_LENGTH, true)}
        </Link>
      )}
    </li>
  )
}

function HomeItem({
  homePath,
  homeLabel,
}: {
  homePath: string
  homeLabel: string
}): React.JSX.Element {
  return (
    <li className={cx('byline-breadcrumbs-item', styles.item)}>
      <Link to={homePath as string} className={cx('byline-breadcrumbs-link', styles.link)}>
        <svg
          role="presentation"
          className={cx('byline-breadcrumbs-home-icon', styles.homeIcon)}
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
        {homeLabel}
      </Link>
    </li>
  )
}

function ChevronIcon({ isLeaf = false }: { isLeaf?: boolean }): React.JSX.Element {
  return (
    <svg
      role="presentation"
      className={cx('byline-breadcrumbs-chevron', styles.chevron, {
        'byline-breadcrumbs-chevron-current': isLeaf,
        [styles.chevronCurrent]: isLeaf,
      })}
      fill="currentColor"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function OverflowDropdown({ items }: { items: Breadcrumb[] }): React.JSX.Element {
  return (
    <li className={cx('byline-breadcrumbs-item', styles.item)}>
      <ChevronIcon />
      <Dropdown.Root>
        <Dropdown.Trigger
          aria-label="Show hidden breadcrumbs"
          className={cx('byline-breadcrumbs-overflow-trigger', styles.overflowTrigger)}
        >
          <EllipsisIcon className={cx('byline-breadcrumbs-overflow-icon', styles.overflowIcon)} />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content sideOffset={5} align="start">
            {items.map((item) => (
              <Dropdown.Item
                key={item.href}
                className={cx('byline-breadcrumbs-overflow-item', styles.overflowItem)}
                render={<Link to={item.href as string} />}
              >
                {item.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </li>
  )
}
