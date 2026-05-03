'use client'

import React from 'react'

import cx from 'classnames'

import { ChevronRightIcon } from '../../icons/chevron-right-icon.js'
import { usePager } from './pagination'
import styles from './pagination.module.css'
import type { PagerButtonProps, RefType } from './pagination'

export type NextButtonProps = PagerButtonProps & {
  page: number | null
}

export const NextButton = ({
  ref,
  className,
  disabled,
  page,
  render,
  children,
  ...rest
}: NextButtonProps & {
  ref?: React.RefObject<RefType>
}) => {
  const { variant, showLastButton } = usePager()

  const sharedProps = {
    className: cx(
      styles['next-button'],
      [styles[variant]],
      { [styles['rounded-right']]: showLastButton == null || showLastButton === false },
      'pagination-next',
      className
    ),
    disabled,
    title: 'Next',
    'data-testid': 'pagination-next',
    ...(disabled ? { 'aria-disabled': true } : { 'aria-label': 'Next' }),
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
          {children ?? <ChevronRightIcon width="18px" height="18px" />}
        </button>
      )}
    </li>
  )
}

NextButton.displayName = 'NextButton'
