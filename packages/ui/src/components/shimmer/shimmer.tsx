import type React from 'react'

import cx from 'classnames'

import styles from './shimmer.module.css'

interface ShimmerProps {
  className?: string
  width?: string | number
  /**
   * Height of the bar. For the single-bar variants (`rectangular`,
   * `circular`, and single-line `text`) this sizes the bar itself. For the
   * multi-line text variant (`variant="text"` with `lines > 1`) it sizes the
   * container that holds the lines — use `lineHeight` to size each line.
   */
  height?: string | number
  /**
   * Height of each line in the multi-line text variant (`variant="text"`
   * with `lines > 1`). Falls back to the `.text` class height (1rem) when
   * omitted. Ignored by the single-bar variants — use `height` there.
   */
  lineHeight?: string | number
  borderRadius?: string
  variant?: 'text' | 'rectangular' | 'circular'
  lines?: number
  children?: React.ReactNode
}

const toCssSize = (value: string | number | undefined): string | undefined =>
  typeof value === 'number' ? `${value}px` : value

export function Shimmer({
  className,
  width = '100%',
  height,
  lineHeight,
  borderRadius,
  variant = 'rectangular',
  lines = 1,
  children,
  ...other
}: ShimmerProps): React.JSX.Element {
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
    // `height` sizes the container; each line is sized by `lineHeight`
    // (undefined falls through to the `.text` class height). `height` is
    // deliberately not spread onto the lines so it can't distort them.
    const resolvedLineHeight = toCssSize(lineHeight)
    return (
      <div
        className={cx(styles.shimmerContainer, className)}
        style={{ width: toCssSize(width), height: toCssSize(height) }}
        {...other}
      >
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={`shimmer-line-${index}`}
            className={cx(styles.shimmer, styles.text)}
            style={{
              width: index === lines - 1 ? '75%' : '100%',
              height: resolvedLineHeight,
              borderRadius,
              marginBottom: index === lines - 1 ? 0 : '0.5rem',
            }}
          />
        ))}
      </div>
    )
  }

  const shimmerStyle = {
    width: toCssSize(width),
    height: toCssSize(height) ?? '1rem',
    borderRadius,
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
