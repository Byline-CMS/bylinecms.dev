'use client'

import React from 'react'

import cx from 'classnames'

import { ChevronLeftIcon } from '../../icons/chevron-left-icon.js'
import { usePager } from './pagination'
import styles from './pagination.module.css'
import type { PagerButtonProps, RefType } from './pagination'

export const PreviousButton = ({
  ref,
  className,
  disabled,
  render,
  children,
  ...rest
}: PagerButtonProps & {
  ref?: React.RefObject<RefType>
}) => {
  const { showFirstButton, variant } = usePager()

  const sharedProps = {
    className: cx(
      styles['previous-button'],
      styles[variant],
      { [styles['rounded-left']]: showFirstButton == null || showFirstButton === false },
      'pagination-previous',
      className
    ),
    disabled,
    title: 'Previous',
    'data-testid': 'pagination-previous',
    ...(disabled ? { 'aria-disabled': true } : { 'aria-label': 'Previous' }),
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
          {children ?? <ChevronLeftIcon width="18px" height="18px" />}
        </button>
      )}
    </li>
  )
}

PreviousButton.displayName = 'PreviousButton'
