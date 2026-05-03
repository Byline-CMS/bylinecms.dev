'use client'

import { type ComponentProps, type MouseEvent, useEffect, useState } from 'react'

import cx from 'classnames'

import styles from './scroll-to-top.module.css'

export interface ScrollToTopProps extends ComponentProps<'button'> {
  /**
   * The scroll position (Y-axis) in pixels that triggers the button to appear.
   * @default 200
   */
  showAt?: number
  /**
   * The target scroll position (Y-axis) to scroll to when clicked.
   * @default -65
   */
  offset?: number
}

export function ScrollToTop({
  className,
  showAt = 200,
  offset = -65,
  type = 'button',
  'aria-label': ariaLabel = 'Scroll to top',
  onClick,
  ...props
}: ScrollToTopProps) {
  const [show, setShow] = useState(false)
  const iconTitle = ariaLabel.trim() ? ariaLabel : 'Scroll to top'

  const handleOnClick = (e: MouseEvent<HTMLButtonElement>): void => {
    window.scrollTo({ top: offset, left: 0, behavior: 'smooth' })
    onClick?.(e)
  }

  useEffect(() => {
    let ticking = false

    const handleOnScroll = (): void => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setShow(window.scrollY > showAt)
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleOnScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleOnScroll)
    }
  }, [showAt])

  return (
    <button
      type={type}
      aria-label={ariaLabel}
      onClick={handleOnClick}
      className={cx(
        'infonomic-scroll-to-top',
        styles['scroll-to-top'],
        {
          'infonomic-scroll-to-top-shown': show,
          [styles['scroll-to-top-shown']]: show,
        },
        className
      )}
      {...props}
    >
      <span aria-hidden="true">
        <svg
          className="icon"
          style={{ fill: 'currentColor' }}
          focusable="false"
          viewBox="0 0 51 32"
        >
          <title>{iconTitle}</title>
          <path d="M25.4,9.8L45.6,30l4.5-4.5L25.4,0.8L0.8,25.4L5.3,30L25.4,9.8z" />
        </svg>
      </span>
    </button>
  )
}
