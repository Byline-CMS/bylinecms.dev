import type React from 'react'

import cx from 'classnames'

import styles from './shimmer.module.css'

interface ShimmerProps {
  className?: string
  width?: string | number
  height?: string | number
  borderRadius?: string
  variant?: 'text' | 'rectangular' | 'circular'
  lines?: number
  children?: React.ReactNode
}

export function Shimmer({
  className,
  width = '100%',
  height = '1rem',
  borderRadius,
  variant = 'rectangular',
  lines = 1,
  children,
  ...other
}: ShimmerProps): React.JSX.Element {
  const shimmerStyle = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: borderRadius,
  }

  const getVariantClass = () => {
    switch (variant) {
      case 'text':
        return styles.text
      case 'circular':
        return styles.circular
      default:
        return styles.rectangular
    }
  }

  if (variant === 'text' && lines > 1) {
    return (
      <div className={cx(styles.shimmerContainer, className)} {...other}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={`shimmer-line-${index}`}
            className={cx(styles.shimmer, styles.text)}
            style={{
              ...shimmerStyle,
              width: index === lines - 1 ? '75%' : '100%',
              marginBottom: index === lines - 1 ? 0 : '0.5rem',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className={cx(styles.shimmer, getVariantClass(), className)}
      style={shimmerStyle}
      {...other}
    >
      {children}
    </div>
  )
}
