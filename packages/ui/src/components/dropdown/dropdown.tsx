'use client'

import type React from 'react'

import { Menu } from '@base-ui/react/menu'
import cx from 'classnames'

import styles from './dropdown.module.css'

function Root({ children, ...rest }: React.ComponentProps<typeof Menu.Root>): React.JSX.Element {
  return <Menu.Root {...rest}>{children}</Menu.Root>
}

const Trigger = ({
  ref,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Menu.Trigger> & {
  ref?: React.RefObject<React.ComponentRef<'button'>>
}): React.JSX.Element => {
  return (
    <Menu.Trigger className={cx('infonomic-dropdown-trigger', className)} ref={ref} {...rest}>
      {children}
    </Menu.Trigger>
  )
}
Trigger.displayName = 'Trigger'

function Portal({
  children,
  ...rest
}: React.ComponentProps<typeof Menu.Portal>): React.JSX.Element {
  return <Menu.Portal {...rest}>{children}</Menu.Portal>
}

const Content = ({
  ref,
  className,
  children,
  side,
  sideOffset,
  align,
  alignOffset,
  collisionPadding,
  ...rest
}: {
  ref?: React.RefObject<React.ComponentRef<'div'>>
  className?: string
  children?: React.ReactNode
  side?: React.ComponentProps<typeof Menu.Positioner>['side']
  sideOffset?: React.ComponentProps<typeof Menu.Positioner>['sideOffset']
  align?: React.ComponentProps<typeof Menu.Positioner>['align']
  alignOffset?: React.ComponentProps<typeof Menu.Positioner>['alignOffset']
  collisionPadding?: React.ComponentProps<typeof Menu.Positioner>['collisionPadding']
} & Omit<React.ComponentProps<typeof Menu.Popup>, 'className'>): React.JSX.Element => {
  return (
    <Menu.Positioner
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
    >
      <Menu.Popup
        ref={ref}
        className={cx('infonomic-dropdown-content', styles['dropdown-content'], className)}
        {...rest}
      >
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  )
}
Content.displayName = 'Content'

const Group = ({
  ref,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Menu.Group> & {
  ref?: React.RefObject<React.ComponentRef<'div'>>
}): React.JSX.Element => {
  return (
    <Menu.Group ref={ref} className={cx('infonomic-dropdown-group', className)} {...rest}>
      {children}
    </Menu.Group>
  )
}
Group.displayName = 'Group'

const Item = ({
  ref,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Menu.Item> & {
  ref?: React.RefObject<React.ComponentRef<'div'>>
}): React.JSX.Element => {
  return (
    <Menu.Item
      ref={ref}
      className={cx('infonomic-dropdown-item', styles['dropdown-item'], className)}
      {...rest}
    >
      {children}
    </Menu.Item>
  )
}
Item.displayName = 'Item'

const Label = ({
  ref,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Menu.GroupLabel> & {
  ref?: React.RefObject<React.ComponentRef<'div'>>
}): React.JSX.Element => {
  return (
    <Menu.GroupLabel ref={ref} className={cx('infonomic-dropdown-label', className)} {...rest}>
      {children}
    </Menu.GroupLabel>
  )
}
Label.displayName = 'Label'

const Separator = ({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof Menu.Separator> & {
  ref?: React.RefObject<React.ComponentRef<'div'>>
}): React.JSX.Element => {
  return (
    <Menu.Separator
      ref={ref}
      className={cx('infonomic-dropdown-separator', styles['dropdown-separator'], className)}
      {...props}
    />
  )
}
Separator.displayName = 'Separator'

function Sub({
  children,
  ...rest
}: React.ComponentProps<typeof Menu.SubmenuRoot>): React.JSX.Element {
  return <Menu.SubmenuRoot {...rest}>{children}</Menu.SubmenuRoot>
}

const SubContent = ({
  ref,
  className,
  children,
  side,
  sideOffset,
  align,
  alignOffset,
  collisionPadding,
  ...rest
}: {
  ref?: React.RefObject<React.ComponentRef<'div'>>
  className?: string
  children?: React.ReactNode
  side?: React.ComponentProps<typeof Menu.Positioner>['side']
  sideOffset?: React.ComponentProps<typeof Menu.Positioner>['sideOffset']
  align?: React.ComponentProps<typeof Menu.Positioner>['align']
  alignOffset?: React.ComponentProps<typeof Menu.Positioner>['alignOffset']
  collisionPadding?: React.ComponentProps<typeof Menu.Positioner>['collisionPadding']
} & Omit<React.ComponentProps<typeof Menu.Popup>, 'className'>): React.JSX.Element => {
  return (
    <Menu.Positioner
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
    >
      <Menu.Popup
        ref={ref}
        className={cx('infonomic-dropdown-subcontent', styles['dropdown-subcontent'], className)}
        {...rest}
      >
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  )
}
SubContent.displayName = 'SubContent'

const SubTrigger = ({
  ref,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Menu.SubmenuTrigger> & {
  ref?: React.RefObject<React.ComponentRef<'div'>>
}): React.JSX.Element => {
  return (
    <Menu.SubmenuTrigger
      ref={ref}
      className={cx('infonomic-dropdown-subtrigger', className)}
      {...rest}
    >
      {children}
    </Menu.SubmenuTrigger>
  )
}
SubTrigger.displayName = 'SubTrigger'

export const Dropdown = {
  Root,
  Trigger,
  Portal,
  Content,
  Group,
  Item,
  Label,
  Separator,
  Sub,
  SubContent,
  SubTrigger,
}
