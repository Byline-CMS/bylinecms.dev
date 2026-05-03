'use client'

import type React from 'react'

import cx from 'classnames'

import styles from './control-buttons.module.css'
import type { Size } from './@types/button.js'

type ButtonType = React.JSX.IntrinsicElements['button']

interface ControlButtonProps extends ButtonType {
  size?: Size
  className?: string
  onClick?: () => void
  ref?: React.RefObject<HTMLButtonElement>
}

interface DirectionalButtonProps extends ControlButtonProps {
  direction: 'up' | 'down' | 'left' | 'right'
}

export const DirectionalButton = ({
  size = 'md',
  direction,
  className,
  onClick,
  ref,
  ...rest
}: DirectionalButtonProps) => {
  const handleClick = (): void => {
    if (onClick != null) {
      onClick()
    }
  }

  return (
    <button
      ref={ref}
      {...rest}
      onClick={handleClick}
      type="button"
      aria-label={direction}
      className={cx(
        'infonomic-control-button',
        direction,
        size,
        styles['directional-button'],
        styles[direction],
        styles[size],
        className
      )}
    >
      <span>
        <svg className="icon" focusable="false" aria-hidden="true" viewBox="0 0 51 32">
          <path
            fill="currentColor"
            d="M25.4,9.8L45.6,30l4.5-4.5L25.4,0.8L0.8,25.4L5.3,30L25.4,9.8z"
          />
        </svg>
      </span>
    </button>
  )
}

export const PlayButton = ({
  size = 'md',
  className,
  onClick,
  ref,
  ...rest
}: ControlButtonProps) => {
  const handleClick = (): void => {
    if (onClick != null) {
      onClick()
    }
  }

  return (
    <button
      ref={ref}
      {...rest}
      onClick={handleClick}
      type="button"
      aria-label="play"
      className={cx('control-button', 'play', size, styles['play-button'], styles[size], className)}
    >
      <span>
        <svg className="icon" focusable="false" aria-hidden="true" viewBox="0 0 32 32">
          <path
            d="M12 8L26 16L12 24V8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  )
}

export const StopButton = ({
  size = 'md',
  className,
  onClick,
  ref,
  ...rest
}: ControlButtonProps) => {
  const handleClick = (): void => {
    if (onClick != null) {
      onClick()
    }
  }

  return (
    <button
      ref={ref}
      {...rest}
      onClick={handleClick}
      type="button"
      aria-label="stop"
      className={cx('control-button', 'stop', size, styles['stop-button'], styles[size], className)}
    >
      <span>
        <svg className="icon" focusable="false" aria-hidden="true" viewBox="0 0 32 32">
          <rect
            x="4"
            y="4"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        </svg>
      </span>
    </button>
  )
}
