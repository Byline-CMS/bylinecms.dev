/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CSSProperties, type MouseEvent, type ReactNode, type Ref, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { ChevronDownIcon, GripperVerticalIcon, useSortable } from '@byline/ui/react'
import cx from 'clsx'

import { useEditorViewState } from '../forms/view-state/editor-view-state-context'
import { targetMarker } from '../forms/view-state/target-markers'
import { DraggableContextMenu } from './draggable-context-menu'
import styles from './sortable-item.module.css'

// ---------------------------------------------------------------------------
// Item chrome for repeating-structure entries (array items, block instances):
// a header carrying the label, the add-below/remove context menu, and a
// collapse toggle, above the item's rendered fields.
//
// Two variants share the frame:
//   - `SortableItem` — adds the dnd-kit grip (drag handle). Must render
//     inside a `DraggableSortable` (it calls `useSortable`).
//   - `StaticItem`  — no grip, no dnd hook. For contexts where drag is
//     disabled but structural editing (add/remove/collapse) must remain,
//     e.g. arrays nested inside another array's items.
//
// They are separate components (not a boolean prop on one component)
// because `useSortable` is a hook — it cannot be called conditionally, and
// it throws outside a DndContext.
// ---------------------------------------------------------------------------

interface ItemFrameProps {
  /**
   * Item instance path; keys the collapsed state in the per-visit view-state
   * store. Optional for external callers of the public export: without it the
   * collapsed state is local only and the store is never read or written.
   */
  itemPath?: string
  label: ReactNode
  children: ReactNode
  onAddBelow?: () => void
  onRemove?: () => void
  /** Drag handle slot — rendered leading the header when provided. */
  grip?: ReactNode
  rootRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  dragging?: boolean
  /** Extra root class, e.g. the static variant marker. */
  rootClassName?: string
}

const ItemFrame = ({
  itemPath,
  label,
  children,
  onAddBelow,
  onRemove,
  grip,
  rootRef,
  style,
  dragging = false,
  rootClassName,
}: ItemFrameProps) => {
  const { t } = useTranslation('byline-admin')
  const viewState = useEditorViewState()
  // Seeded once from the per-visit store. Local state stays authoritative so
  // positional (untrusted) items, which the store ignores, still toggle.
  const store = viewState && itemPath ? viewState : null
  const [collapsed, setCollapsed] = useState(() =>
    itemPath ? (store?.isCollapsed(itemPath) ?? false) : false
  )

  const toggleCollapsed = (event: MouseEvent<HTMLButtonElement>) => {
    const next = !collapsed
    setCollapsed(next)
    if (store && itemPath) {
      store.setCollapsed(itemPath, next)
      store.setTarget({
        path: itemPath,
        role: 'toggle',
        offset: event.currentTarget.getBoundingClientRect().top,
      })
    }
  }

  return (
    <div
      ref={rootRef}
      style={style}
      className={cx(
        'byline-sortable',
        styles.root,
        rootClassName,
        dragging && ['byline-sortable-dragging', styles.dragging],
        collapsed && ['byline-sortable-collapsed', styles.collapsed]
      )}
    >
      <div
        className={cx(
          'byline-sortable-header',
          styles.header,
          !collapsed && ['byline-sortable-header-expanded', styles['header-expanded']]
        )}
      >
        {grip}
        <div className={cx('byline-sortable-label', styles.label)}>{label}</div>
        <DraggableContextMenu itemPath={itemPath} onAddBelow={onAddBelow} onRemove={onRemove} />
        <button
          type="button"
          className={cx('byline-sortable-toggle', styles.toggle)}
          onClick={toggleCollapsed}
          {...(itemPath ? targetMarker(itemPath, 'toggle') : {})}
          aria-label={
            collapsed
              ? t('fields.sortable.expandAriaLabel')
              : t('fields.sortable.collapseAriaLabel')
          }
        >
          <ChevronDownIcon
            className={cx(
              'byline-sortable-toggle-icon',
              styles['toggle-icon'],
              collapsed && ['byline-sortable-toggle-icon-rotated', styles['toggle-icon-rotated']]
            )}
          />
        </button>
      </div>
      <div
        className={cx(
          'byline-sortable-content',
          styles.content,
          collapsed && ['byline-sortable-content-hidden', styles['content-hidden']]
        )}
      >
        {children}
      </div>
    </div>
  )
}

export const SortableItem = ({
  id,
  itemPath,
  label,
  children,
  onAddBelow,
  onRemove,
}: {
  id: string
  itemPath?: string
  label: ReactNode
  children: ReactNode
  onAddBelow?: () => void
  onRemove?: () => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <ItemFrame
      itemPath={itemPath}
      label={label}
      onAddBelow={onAddBelow}
      onRemove={onRemove}
      rootRef={setNodeRef}
      style={style}
      dragging={isDragging}
      grip={
        <button
          type="button"
          className={cx('byline-sortable-grip', styles.grip)}
          {...attributes}
          {...listeners}
          {...(itemPath ? targetMarker(itemPath, 'grip') : {})}
        >
          <GripperVerticalIcon className={cx('byline-sortable-grip-icon', styles['grip-icon'])} />
        </button>
      }
    >
      {children}
    </ItemFrame>
  )
}

export const StaticItem = ({
  itemPath,
  label,
  children,
  onAddBelow,
  onRemove,
}: {
  itemPath?: string
  label: ReactNode
  children: ReactNode
  onAddBelow?: () => void
  onRemove?: () => void
}) => (
  <ItemFrame
    itemPath={itemPath}
    label={label}
    onAddBelow={onAddBelow}
    onRemove={onRemove}
    rootClassName="byline-sortable-static"
  >
    {children}
  </ItemFrame>
)
