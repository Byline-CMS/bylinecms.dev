'use client'

import type React from 'react'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import cx from 'classnames'

import { Ripple } from '../../lib/ripple.js'
import styles from './button.module.css'
import type { Intent, Size, Variant } from './@types/button.js'

export type ButtonProps = useRender.ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
  type?: 'submit' | 'reset' | 'button'
  intent?: Intent
  fullWidth?: boolean
  ripple?: boolean
  className?: string
  children?: React.ReactNode
  ref?: React.Ref<HTMLButtonElement>
} & React.HTMLAttributes<HTMLElement>

export const Button = ({
  variant = 'filled',
  size = 'md',
  type = 'button',
  intent = 'primary',
  fullWidth = false,
  ripple = true,
  className,
  children,
  render,
  ref,
  ...rest
}: ButtonProps) => {
  const defaultProps: Record<string, unknown> = {
    type,
    className: cx(
      'byline-button',
      `byline-button-${intent}`,
      `byline-button-${variant}`,
      `byline-button-${size}`,
      styles.button,
      styles[variant],
      styles[size],
      styles[intent],
      { [styles.fullWidth]: fullWidth === true },
      className
    ),
    children,
  }

  if (ripple === true) {
    const rippleEffect = new Ripple()
    defaultProps.onMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
      rippleEffect.create(e, variant === 'filled' || variant === 'gradient' ? 'light' : 'dark')
    }
  }

  const element = useRender({
    defaultTagName: 'button',
    render,
    ref,
    props: mergeProps<'button'>(defaultProps, rest),
  })

  return element
}
