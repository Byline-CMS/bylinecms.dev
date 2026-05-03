'use client'

import React from 'react'

import cx from 'classnames'

import { ChevronRightDoubleIcon } from '../../icons/chevron-right-double-icon.js'
import { usePager } from './pagination'
import styles from './pagination.module.css'
import type { PagerButtonProps, RefType } from './pagination'

export type LastButtonProps = PagerButtonProps & {
  count: number
}

export const LastButton = ({
  ref,
  className,
  disabled,
  count,
  render,
  children,
  ...rest
}: LastButtonProps & {
  ref?: React.RefObject<RefType>
}) => {
  const { variant } = usePager()

  const sharedProps = {
    className: cx(
      styles['last-button'],
      styles[variant],
      styles['rounded-right'],
      'pagination-last',
      className
    ),
    disabled,
    title: 'Last',
    'data-testid': 'pagination-last',
    ...(disabled ? { 'aria-disabled': true } : { 'aria-label': 'Last' }),
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
          {children ?? <ChevronRightDoubleIcon width="18px" height="18px" />}
        </button>
      )}
    </li>
  )
}

LastButton.displayName = 'LastButton'
