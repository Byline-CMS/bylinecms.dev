import type React from 'react'

import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import cx from 'classnames'

import styles from './scroll-area.module.css'

interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {}

export const ScrollArea = ({ children, style, className }: ScrollAreaProps) => (
  <ScrollAreaPrimitive.Root
    style={style}
    className={cx('byline-scroll-area', styles.root, className)}
  >
    <ScrollAreaPrimitive.Viewport className={cx('byline-scroll-area-viewport', styles.viewport)}>
      <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      className={cx('byline-scroll-area-scrollbar', styles.scrollbar)}
      orientation="vertical"
    >
      <ScrollAreaPrimitive.Thumb className={cx('byline-scroll-area-thumb', styles.thumb)} />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Scrollbar
      className={cx('byline-scroll-area-scrollbar', styles.scrollbar)}
      orientation="horizontal"
    >
      <ScrollAreaPrimitive.Thumb className={cx('byline-scroll-area-thumb', styles.thumb)} />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner className={cx('byline-scroll-area-corner', styles.corner)} />
  </ScrollAreaPrimitive.Root>
)
