'use client'

import React from 'react'

import cx from 'classnames'

import { ChevronLeftDoubleIcon } from '../../icons/chevron-left-double-icon.js'
import { usePager } from './pagination'
import styles from './pagination.module.css'
import type { PagerButtonProps, RefType } from './pagination'

export const FirstButton = ({
  ref,
  className,
  disabled,
  render,
  children,
  ...rest
}: PagerButtonProps & {
  ref?: React.RefObject<RefType>
}) => {
  const { variant } = usePager()

  const sharedProps = {
    className: cx(
      styles['first-button'],
      styles[variant],
      styles['rounded-left'],
      'pagination-first',
      className
    ),
    disabled,
    'data-testid': 'pagination-first',
    title: 'First',
    ...(disabled ? { 'aria-disabled': true } : { 'aria-label': 'First' }),
    ...rest,
  }

  return (
    <li className={styles['mobile-toggle']}>
      {render ? (
        React.cloneElement(
          render,
          { ref, ...sharedProps } as React.Attributes & Record<string, unknown>,
          children
        )
      ) : (
        <button ref={ref as React.RefObject<HTMLButtonElement>} {...sharedProps}>
          {children ?? <ChevronLeftDoubleIcon width="18px" height="18px" />}
        </button>
      )}
    </li>
  )
}

FirstButton.displayName = 'FirstButton'
