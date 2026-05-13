'use client'

/**
 * NOTE: An accordion can be used in a variety of ways, including
 * simple FAQs, complex navigation, and more. As such, we minimally
 * style the accordion here in order to provide a base for customization.
 */

import type React from 'react'

import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import cx from 'classnames'

import styles from './accordion.module.css'

export type AccordionRootElement = React.ComponentRef<'div'>

const Root = ({
  children,
  className,
  ref,
  ...props
}: {
  children: React.ReactNode
  className?: string
  ref?: React.RefObject<AccordionRootElement>
} & React.ComponentProps<typeof AccordionPrimitive.Root>) => {
  return (
    <AccordionPrimitive.Root
      ref={ref}
      className={cx('byline-accordion-root', className)}
      {...props}
    >
      {children}
    </AccordionPrimitive.Root>
  )
}

export type AccordionItemElement = React.ComponentRef<'div'>
const Item = function AccordionItem({
  ref,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item> & {
  ref?: React.RefObject<AccordionItemElement>
}) {
  return (
    <AccordionPrimitive.Item
      className={cx('byline-accordion-item', className)}
      {...props}
      ref={ref}
    >
      {children}
    </AccordionPrimitive.Item>
  )
}

export type AccordionHeaderElement = React.ComponentRef<'h3'>
const Header = function AccordionHeader({
  ref,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Header> & {
  ref?: React.RefObject<AccordionHeaderElement>
}) {
  return (
    <AccordionPrimitive.Header
      className={cx('byline-accordion-header', className)}
      {...props}
      ref={ref}
    >
      {children}
    </AccordionPrimitive.Header>
  )
}

export type AccordionTriggerElement = React.ComponentRef<'button'>
const Trigger = function AccordionTrigger({
  ref,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  ref?: React.RefObject<AccordionTriggerElement>
}) {
  return (
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cx('byline-accordion-trigger', styles.trigger, className)}
      {...props}
    >
      {children}
    </AccordionPrimitive.Trigger>
  )
}

export type AccordionPanelElement = React.ComponentRef<'div'>
const Panel = function AccordionPanel({
  ref,
  children,
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel> & {
  ref?: React.RefObject<AccordionPanelElement>
}) {
  return (
    <AccordionPrimitive.Panel
      className={cx('byline-accordion-content', styles.content, className)}
      {...props}
      ref={ref}
    >
      {children}
    </AccordionPrimitive.Panel>
  )
}

export const Accordion = {
  Root,
  Item,
  Header,
  Trigger,
  Panel,
}
