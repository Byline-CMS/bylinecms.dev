'use client'

import type * as React from 'react'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import cx from 'classnames'

import styles from './tabs.module.css'

const Tabs = ({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  ref?: React.RefObject<HTMLDivElement>
}) => (
  <TabsPrimitive.Root
    ref={ref}
    className={cx(styles['tabs-root'], 'byline-tabs-root', className)}
    {...props}
  />
)
Tabs.displayName = 'Tabs'

const TabsList = ({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  ref?: React.RefObject<HTMLDivElement>
}) => (
  <TabsPrimitive.List
    ref={ref}
    className={cx(styles['tabs-list'], 'byline-tabs-list', className)}
    {...props}
  />
)
TabsList.displayName = 'TabsList'

const TabsTrigger = ({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab> & {
  ref?: React.RefObject<HTMLButtonElement>
}) => (
  <TabsPrimitive.Tab
    ref={ref}
    className={cx(styles['tabs-trigger'], 'byline-tabs-trigger', className)}
    {...props}
  />
)
TabsTrigger.displayName = 'TabsTrigger'

const TabsContent = ({
  ref,
  className,
  keepMounted = true,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel> & {
  ref?: React.RefObject<HTMLDivElement>
}) => (
  <TabsPrimitive.Panel
    ref={ref}
    keepMounted={keepMounted}
    className={cx(styles['tabs-content'], 'byline-tabs-content', className)}
    {...props}
  />
)
TabsContent.displayName = 'TabsContent'

Tabs.List = TabsList
Tabs.Trigger = TabsTrigger
Tabs.Content = TabsContent

export { Tabs }
