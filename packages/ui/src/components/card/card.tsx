import type React from 'react'

import { useRender } from '@base-ui/react/use-render'
import cx from 'classnames'

import styles from './card.module.css'

export type CardProps = useRender.ComponentProps<'div'> & {
  children: React.ReactNode
  className?: string
  hover?: boolean
  ref?: React.Ref<HTMLDivElement>
}

const Card = ({ className, hover, children, render, ref, ...rest }: CardProps) => {
  const hoverClasses = hover != null && hover === true ? styles['card-hover'] : undefined
  const classes = cx('infonomic-card', styles.card, hoverClasses, className)

  const element = useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: {
      ...rest,
      className: classes,
      children,
    },
  })

  return element
}

Card.displayName = 'Card'

interface OtherProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>
}

const Header = ({ className, ref, ...props }: OtherProps) => (
  <div
    ref={ref}
    className={cx('infonomic-card-header', styles['card-header'], className)}
    {...props}
  />
)

Header.displayName = 'CardHeader'

const Title = ({ className, ref, ...props }: OtherProps) => (
  <div
    ref={ref as React.Ref<HTMLDivElement>}
    className={cx('infonomic-card-title', styles['card-title'], className)}
    {...props}
  />
)
Title.displayName = 'CardTitle'

const Description = ({ className, ref, ...props }: OtherProps) => (
  <div
    ref={ref}
    className={cx('infonomic-card-description', styles['card-description'], className)}
    {...props}
  />
)
Description.displayName = 'CardDescription'

const Content = ({ className, ref, ...props }: OtherProps) => (
  <div
    ref={ref}
    className={cx('infonomic-card-content', styles['card-content'], className)}
    {...props}
  />
)
Content.displayName = 'CardContent'

const Footer = ({ className, ref, ...props }: OtherProps) => (
  <div
    ref={ref}
    className={cx('infonomic-card-footer', styles['card-footer'], className)}
    {...props}
  />
)
Footer.displayName = 'CardFooter'

Card.Header = Header
Card.Title = Title
Card.Description = Description
Card.Content = Content
Card.Footer = Footer

export { Card }
