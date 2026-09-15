'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Badge, Dropdown, EllipsisIcon } from '@byline/ui/react'
import cx from 'clsx'

import { advanceDrag, type DragState, shouldStartDrag, shouldSuppressClick } from './tab-strip-drag'
import { computeRevealScroll, computeStripState, type StripState } from './tab-strip-geometry'
import styles from './tabs.module.css'

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Size and offset of the overflow trigger, in pixels.
 *
 * Pushed onto the element as custom properties so the stylesheet lays the
 * trigger out from the same numbers the geometry reserves space with. Pixels
 * rather than `rem` deliberately: the trigger is icon-only, so it has no text
 * to scale, and a fixed size keeps the reserved width correct under text
 * scaling and translation alike.
 */
const TRIGGER_SIZE_PX = 32
const TRIGGER_GAP_PX = 12

const INITIAL_STRIP_STATE: StripState = {
  overflowing: false,
  viewportWidth: 0,
  atStart: true,
  atEnd: true,
}

export interface AdminTabItem {
  name: string
  label: string
}

interface AdminTabsProps {
  tabs: AdminTabItem[]
  activeTab: string
  onChange: (name: string) => void
  /**
   * Prefix for the generated tab and panel ids. The consumer that renders the
   * panels builds its panel ids from the same base via `tabPanelId`, which is
   * what associates the two halves for assistive technology.
   */
  idBase: string
  /** Error counts keyed by tab name — shows a danger badge when > 0. */
  errorCounts?: Record<string, number>
  className?: string
}

/** Id of the button for one tab. */
export const tabTriggerId = (idBase: string, name: string): string => `${idBase}-tab-${name}`

/** Id the consumer must put on the panel belonging to one tab. */
export const tabPanelId = (idBase: string, name: string): string => `${idBase}-panel-${name}`

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Tabs navigation bar for admin form layouts.
 *
 * Used by FormRenderer when a CollectionAdminConfig declares a `tabs` array,
 * and by the collection history view. The number of tabs a collection can
 * declare is unbounded while the column they sit in is not, so the strip
 * scrolls horizontally and — only once the tabs genuinely exceed the column —
 * grows a menu listing every tab.
 *
 * The menu is a jump list rather than a list of the tabs that happen to be
 * out of view: its contents stay put as the strip scrolls, and no tab ever
 * changes position in the strip as a result of being selected. Editors learn
 * where a tab lives and it stays there.
 *
 * Scroll position is moved only when the selection changes or a tab takes
 * focus. A reader who scrolls the strip to look at other labels keeps their
 * position through re-measurement, re-render and resize.
 *
 * Stable override handles: `.byline-admin-tabs`, `.byline-admin-tabs-viewport`,
 * `.byline-admin-tablist`, `.byline-admin-tab`, `.byline-admin-tab-active`,
 * `.byline-admin-tab-label`, `.byline-admin-tab-badge`,
 * `.byline-admin-tabs-overflow-trigger`, `.byline-admin-tabs-overflow-menu`,
 * `.byline-admin-tabs-overflow-item`.
 */
export const AdminTabs = ({
  tabs,
  activeTab,
  onChange,
  idBase,
  errorCounts,
  className,
}: AdminTabsProps) => {
  const { t } = useTranslation('byline-admin')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  // Set when a change originates from the keyboard or the menu, so focus
  // follows the selection once the parent has re-rendered with it.
  const focusAfterChange = useRef<string | null>(null)

  const [strip, setStrip] = useState<StripState>(INITIAL_STRIP_STATE)

  // The measurement effect is keyed on what the tabs *are*, not on the identity
  // of the array carrying them. A form layout rebuilds that array on every
  // render — `useFormTabs.resolve()` filters `set.tabs` against live form data,
  // so a new array arrives per keystroke — and re-running the effect for one of
  // those renders would disconnect the observer and force a synchronous layout
  // read on a tree the browser has just invalidated. Labels are part of the key
  // because the label is what carries the width: a translation change has to
  // re-measure, a keystroke elsewhere in the form does not.
  const tabsKey = tabs.map((tab) => `${tab.name}:${tab.label}`).join('\u0000')

  const measure = useCallback(() => {
    const container = containerRef.current
    const row = rowRef.current
    if (container == null || row == null) return

    const next = computeStripState({
      rowWidth: row.scrollWidth,
      containerWidth: container.clientWidth,
      triggerWidth: TRIGGER_SIZE_PX,
      triggerGap: TRIGGER_GAP_PX,
      scrollLeft: viewportRef.current?.scrollLeft ?? 0,
    })

    setStrip((prev) =>
      prev.overflowing === next.overflowing &&
      prev.viewportWidth === next.viewportWidth &&
      prev.atStart === next.atStart &&
      prev.atEnd === next.atEnd
        ? prev
        : next
    )
  }, [])

  useIsoLayoutEffect(() => {
    measure()

    const container = containerRef.current
    const row = rowRef.current
    if (container == null || row == null || typeof ResizeObserver === 'undefined') return

    // The row is observed alongside the container because most of what changes
    // the strip's width is content, not layout: a label being translated, an
    // error badge appearing mid-validation, a conditional tab unmounting. None
    // of those resize the container at all.
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    observer.observe(row)
    return () => observer.disconnect()
  }, [measure, tabsKey])

  const reveal = useCallback((name: string) => {
    const viewport = viewportRef.current
    const row = rowRef.current
    const tab = tabRefs.current.get(name)
    if (viewport == null || row == null || tab == null) return

    const next = computeRevealScroll({
      viewportWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      tabOffsetLeft: tab.offsetLeft,
      tabWidth: tab.offsetWidth,
      rowWidth: row.scrollWidth,
    })
    // `null` means the tab is already visible. Writing the current offset back
    // would interrupt a scroll the reader is in the middle of.
    if (next == null) return

    // Scrolling the viewport directly rather than via `scrollIntoView`, which
    // walks up the ancestor chain and would move the page vertically as well.
    viewport.scrollTo?.({ left: next, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    const pending = focusAfterChange.current
    if (pending === activeTab) {
      focusAfterChange.current = null
      // `preventScroll` because the browser's own scroll-on-focus would scroll
      // ancestors too; `reveal` below moves only the strip.
      tabRefs.current.get(activeTab)?.focus({ preventScroll: true })
    }
    reveal(activeTab)
  }, [activeTab, reveal])

  const select = useCallback(
    (name: string, moveFocus: boolean) => {
      if (moveFocus) focusAfterChange.current = name
      onChange(name)
    },
    [onChange]
  )

  // ─── Drag-to-scroll ────────────────────────────────────────────────────
  //
  // Touch scrolls the viewport natively; this exists for mouse users, who
  // otherwise have no way to reach an off-screen tab but the menu — a plain
  // wheel has no horizontal axis.

  const dragRef = useRef<DragState | null>(null)
  // When the last drag ended. A drag finishing over a tab would otherwise
  // select it, and a timestamp expires on its own where a flag would sit armed
  // waiting for a click that a drag released off-strip never produces.
  const dragEndedAtRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (viewport == null) return
    if (
      shouldStartDrag({
        pointerType: event.pointerType,
        button: event.button,
        overflowing: strip.overflowing,
      }) === false
    ) {
      return
    }
    dragRef.current = {
      origin: { pointerX: event.clientX, scrollLeft: viewport.scrollLeft },
      dragging: false,
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    const viewport = viewportRef.current
    const row = rowRef.current
    if (state == null || viewport == null || row == null) return

    const maxScroll = Math.max(0, row.scrollWidth - viewport.clientWidth)
    const next = advanceDrag(state, event.clientX, maxScroll)
    // Still inside the threshold — leave the viewport alone so the gesture can
    // still resolve as a click.
    if (next.scrollLeft == null) return

    if (state.dragging === false) {
      state.dragging = true
      setDragging(true)
      // Capture so the drag survives the pointer leaving the strip, which is
      // most of the point: you can pull well past the edge and keep going.
      viewport.setPointerCapture?.(event.pointerId)
    }
    viewport.scrollLeft = next.scrollLeft
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (state == null) return
    dragRef.current = null
    if (state.dragging === false) return

    setDragging(false)
    viewportRef.current?.releasePointerCapture?.(event.pointerId)
    dragEndedAtRef.current = performance.now()
  }

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (shouldSuppressClick(dragEndedAtRef.current, performance.now()) === false) return
    dragEndedAtRef.current = null
    event.stopPropagation()
    event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.name === activeTab)
    if (current < 0 || tabs.length === 0) return

    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (current + 1) % tabs.length
        break
      case 'ArrowLeft':
        nextIndex = (current - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabs.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const next = tabs[nextIndex]
    if (next == null || next.name === activeTab) return
    select(next.name, true)
  }

  const sizing = {
    '--byline-admin-tabs-trigger-size': `${TRIGGER_SIZE_PX}px`,
    '--byline-admin-tabs-trigger-gap': `${TRIGGER_GAP_PX}px`,
  } as CSSProperties

  return (
    <div
      ref={containerRef}
      style={sizing}
      className={cx('byline-admin-tabs', styles.tabs, className)}
    >
      <div
        ref={viewportRef}
        onScroll={measure}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClickCapture={handleClickCapture}
        data-at-start={strip.atStart}
        data-at-end={strip.atEnd}
        data-draggable={strip.overflowing}
        data-dragging={dragging}
        className={cx('byline-admin-tabs-viewport', styles.viewport)}
      >
        <div
          ref={rowRef}
          role="tablist"
          aria-label={t('presentation.formTabsAriaLabel')}
          onKeyDown={handleKeyDown}
          className={cx('byline-admin-tablist', styles.tablist)}
        >
          {tabs.map((tab) => {
            const isActive = tab.name === activeTab
            const errorCount = errorCounts?.[tab.name] ?? 0
            return (
              <button
                key={tab.name}
                ref={(node) => {
                  if (node == null) tabRefs.current.delete(tab.name)
                  else tabRefs.current.set(tab.name, node)
                }}
                type="button"
                role="tab"
                id={tabTriggerId(idBase, tab.name)}
                aria-controls={tabPanelId(idBase, tab.name)}
                aria-selected={isActive}
                // Roving tabindex: the strip is one stop in the tab order, and
                // the arrow keys move within it.
                tabIndex={isActive ? 0 : -1}
                onClick={() => select(tab.name, false)}
                onFocus={() => reveal(tab.name)}
                className={cx(
                  'byline-admin-tab',
                  styles.tab,
                  isActive && ['byline-admin-tab-active', styles['tab-active']]
                )}
              >
                <span className={cx('byline-admin-tab-label', styles.label)}>
                  {tab.label}
                  {errorCount > 0 && (
                    <Badge intent="danger" className={cx('byline-admin-tab-badge', styles.badge)}>
                      {errorCount}
                    </Badge>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {strip.overflowing && (
        <Dropdown.Root>
          <Dropdown.Trigger
            aria-label={t('presentation.formTabsAllTabsLabel')}
            className={cx('byline-admin-tabs-overflow-trigger', styles['overflow-trigger'])}
          >
            <EllipsisIcon
              className={cx('byline-admin-tabs-overflow-icon', styles['overflow-icon'])}
            />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              sideOffset={6}
              align="end"
              className={cx('byline-admin-tabs-overflow-menu', styles['overflow-menu'])}
            >
              {tabs.map((tab) => {
                const errorCount = errorCounts?.[tab.name] ?? 0
                return (
                  <Dropdown.Item
                    key={tab.name}
                    onClick={() => select(tab.name, true)}
                    data-active={tab.name === activeTab}
                    className={cx('byline-admin-tabs-overflow-item', styles['overflow-item'])}
                  >
                    {tab.label}
                    {errorCount > 0 && (
                      <Badge intent="danger" className={cx('byline-admin-tab-badge', styles.badge)}>
                        {errorCount}
                      </Badge>
                    )}
                  </Dropdown.Item>
                )
              })}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      )}
    </div>
  )
}
