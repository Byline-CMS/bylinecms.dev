'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { Drawer as BaseDrawer } from '@base-ui/react/drawer'
import cx from 'classnames'

import styles from './drawer.module.css'
import { DrawerContainer } from './drawer-container'
import { DrawerContent } from './drawer-content'
import { useDrawer } from './drawer-context'
import { DrawerHeader } from './drawer-header'
import { DrawerTopActions } from './drawer-top-actions'

type Styles = {
  [key: string]: string
}

const typedStyles: Styles = styles

export interface DrawerProps {
  id: string
  isOpen: boolean
  closeOnOverlayClick?: boolean
  onDismiss: () => void
  children: ReactNode
  width?: 'narrow' | 'medium' | 'wide'
  topOffset?: string
  className?: string
}

const Drawer = ({
  id,
  isOpen,
  onDismiss,
  closeOnOverlayClick,
  children,
  width = 'narrow',
  topOffset = '0',
  className,
}: DrawerProps) => {
  const { addDrawer, removeDrawer, drawers } = useDrawer()
  const depth = drawers.indexOf(id)

  useEffect(() => {
    if (isOpen) {
      addDrawer(id)
    } else {
      removeDrawer(id)
    }
    return () => removeDrawer(id)
  }, [isOpen, id, addDrawer, removeDrawer])

  const hasTopOffset = topOffset !== '0'

  return (
    <BaseDrawer.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss()
        }
      }}
      modal={hasTopOffset ? 'trap-focus' : true}
      swipeDirection="right"
      disablePointerDismissal={closeOnOverlayClick !== true}
    >
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop
          className={cx('byline-drawer-backdrop', styles.backdrop)}
          style={hasTopOffset ? { top: topOffset } : undefined}
        />
        {/* Base UI expects <Popup> to live inside a <Viewport> — the element
            that owns swipe-dismiss + touch scroll-locking. Our positioning
            lives on the Popup itself, so the Viewport is a layout-neutral
            (`display: contents`) wrapper here: it satisfies the context and
            silences the warning without disturbing the Popup's fixed layout. */}
        <BaseDrawer.Viewport className={cx('byline-drawer-viewport', styles.viewport)}>
          <BaseDrawer.Popup
            className={cx(
              'byline-drawer-wrapper',
              styles['drawer-wrapper'],
              typedStyles[`drawer-${width}`],
              typedStyles[`drawer-depth-${depth.toString()}`],
              className
            )}
            style={hasTopOffset ? { top: topOffset } : undefined}
          >
            {children}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  )
}

Drawer.displayName = 'Drawer'

Drawer.Container = DrawerContainer
Drawer.Content = DrawerContent
Drawer.Header = DrawerHeader
Drawer.TopActions = DrawerTopActions

export { Drawer }
