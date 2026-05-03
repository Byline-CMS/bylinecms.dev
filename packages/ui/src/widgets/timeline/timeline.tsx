'use client'

import type React from 'react'

import cx from 'classnames'

import styles from './timeline.module.css'

// Timeline Container
export interface TimelineProps {
  id?: string
  className?: string
  'aria-label'?: string
  children?: React.ReactNode
}

export const Timeline = ({
  id,
  className,
  children,
  ...rest
}: TimelineProps): React.JSX.Element => {
  return (
    <div id={id} className={cx(styles.timeline, 'timeline', className)} {...rest}>
      {children}
    </div>
  )
}

// Timeline Root
type RootElement = React.ComponentRef<'ol'>
type PrimitiveRootProps = React.ComponentPropsWithoutRef<'ol'>
interface RootProps extends PrimitiveRootProps {
  className?: string
}
const Root = function TimelineRoot({
  ref,
  children,
  className,
  ...props
}: RootProps & {
  ref?: React.RefObject<RootElement>
}) {
  const classes = cx(styles['timeline-root'], 'timeline-root', className)
  return (
    <ol ref={ref} {...props} className={classes}>
      {children}
    </ol>
  )
}

// Timeline Item
type ItemElement = React.ComponentRef<'li'>
type PrimitiveItemProps = React.ComponentPropsWithoutRef<'li'>
interface ItemProps extends PrimitiveItemProps {
  className?: string
}
const Item = function TimelineItem({
  ref,
  children,
  className,
  ...props
}: ItemProps & {
  ref?: React.RefObject<ItemElement>
}) {
  return (
    <li ref={ref} {...props} className={cx(styles['timeline-item'], 'timeline-item', className)}>
      {children}
    </li>
  )
}

// Timeline Item Icon
type IconElement = React.ComponentRef<'span'>
type PrimitiveIconProps = React.ComponentPropsWithoutRef<'span'>
interface IconProps extends PrimitiveIconProps {
  className?: string
}
const Icon = function TimelineIcon({
  ref,
  children,
  className,
  ...props
}: IconProps & {
  ref?: React.RefObject<IconElement>
}) {
  return (
    <span ref={ref} {...props} className={cx(styles['timeline-icon'], 'time-line-icon', className)}>
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M20 4a2 2 0 0 0-2-2h-2V1a1 1 0 0 0-2 0v1h-3V1a1 1 0 0 0-2 0v1H6V1a1 1 0 0 0-2 0v1H2a2 2 0 0 0-2 2v2h20V4ZM0 18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8H0v10Zm5-8h10a1 1 0 0 1 0 2H5a1 1 0 0 1 0-2Z" />
      </svg>
    </span>
  )
}

// Timeline Item Heading
type HeadingElement = React.ComponentRef<'h3'>
type PrimitiveHeadingProps = React.ComponentPropsWithoutRef<'h3'>
interface HeadingProps extends PrimitiveHeadingProps {
  className?: string
}
const Heading = function TimelineHeading({
  ref,
  children,
  className,
  ...props
}: HeadingProps & {
  ref?: React.RefObject<HeadingElement>
}) {
  return (
    <h3
      ref={ref}
      {...props}
      className={cx(styles['timeline-heading'], 'timeline-heading', className)}
    >
      {children}
    </h3>
  )
}

// Timeline Item Date
type DateElement = React.ComponentRef<'time'>
type PrimitiveDateProps = React.ComponentPropsWithoutRef<'time'>
interface DateProps extends PrimitiveDateProps {
  className?: string
}
const DateItem = function TimelineDate({
  ref,
  children,
  className,
  ...props
}: DateProps & {
  ref?: React.RefObject<DateElement>
}) {
  return (
    <time ref={ref} {...props} className={cx(styles['timeline-date'], 'timeline-date', className)}>
      {children}
    </time>
  )
}

// Timeline Item Content
type ContentElement = React.ComponentRef<'p'>
type PrimitiveContentProps = React.ComponentPropsWithoutRef<'div'>
interface ContentProps extends PrimitiveContentProps {
  className?: string
}
const Content = function TimelineContent({
  ref,
  children,
  className,
  ...props
}: ContentProps & {
  ref?: React.RefObject<ContentElement>
}) {
  return (
    <div
      ref={ref}
      {...props}
      className={cx(styles['timeline-content'], 'timeline-content', className)}
    >
      {children}
    </div>
  )
}

Timeline.Root = Root
Timeline.Item = Item
Timeline.Icon = Icon
Timeline.Heading = Heading
Timeline.Date = DateItem
Timeline.Content = Content
