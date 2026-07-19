'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type { TocHeading } from '@/modules/docs/toc'

/** Matches the `scroll-margin-top` applied to docs headings in content.module.css. */
const HEADING_OFFSET = 80

/**
 * Track which heading the reader is currently under.
 *
 * The active heading is the last one whose top edge has passed the offset line,
 * which is what a reader means by "the section I am in" — including while
 * reading the body text well below the heading itself. Two edges are handled
 * explicitly: above the first heading nothing is active, and at the bottom of
 * the page the final heading wins even if its section is too short to reach the
 * offset line, so the last entry is always reachable.
 *
 * Reads layout on a rAF-throttled scroll, so at most one measuring pass runs
 * per frame.
 */
export function useActiveHeading(headings: TocHeading[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId(null)
      return
    }

    let frame = 0

    const measure = (): void => {
      frame = 0

      // Bottom of the document — the last heading is the one in view.
      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      if (scrolledToBottom) {
        setActiveId(headings[headings.length - 1].id)
        return
      }

      let current: string | null = null
      for (const heading of headings) {
        const element = document.getElementById(heading.id)
        if (element == null) continue
        if (element.getBoundingClientRect().top <= HEADING_OFFSET) {
          current = heading.id
        } else {
          // Headings are in document order, so the first one below the line
          // ends the search.
          break
        }
      }
      setActiveId(current)
    }

    const onScroll = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [headings])

  return activeId
}
