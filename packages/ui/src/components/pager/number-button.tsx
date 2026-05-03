'use client'

import React from 'react'

import cx from 'classnames'

import { useMediaQuery } from '../../hooks/use-media-query'
import { usePager } from './pagination'
import styles from './pagination.module.css'
import type { PagerButtonProps, RefType } from './pagination'

export type NumberButtonProps = PagerButtonProps & {
  page: number | null
  activeClassName?: string
  selected?: boolean
}

export const NumberButton = ({
  ref,
  page,
  className,
  disabled,
  activeClassName,
  render,
  children,
  ...rest
}: NumberButtonProps & {
  ref?: React.RefObject<RefType>
}) => {
  const mobile = useMediaQuery('(max-width: 640px)')
  const {
    variant,
    currentPage,
    count,
    showFirstButton,
    showLastButton,
    hideNextButton,
    hidePrevButton,
  } = usePager()

  const active = page === currentPage

  const sharedProps = {
    className: cx(
      styles['number-button'],
      [styles[variant]],
      { [styles.active]: active === true, active: active === true },
      {
        [styles['rounded-left']]:
          page === 1 && ((!(showFirstButton ?? false) && (hidePrevButton ?? false)) || mobile),
      },
      {
        [styles['rounded-right']]:
          page === count && ((!(showLastButton ?? false) && (hideNextButton ?? false)) || mobile),
      },
      'pagination-number',
      className
    ),
    'data-testid':
      cx({
        'pager-number-active': currentPage === page,
        [`pager-number-${page}`]: currentPage !== page,
      }).length > 0 || undefined,
    disabled,
    'aria-current': currentPage === page,
    'aria-label': currentPage === page ? `Current Page, Page ${page}` : `Page ${page}`,
    ...rest,
  }

  return (
    <li className="flex">
      {render ? (
        React.cloneElement(
          render,
          { ref, ...sharedProps } as React.Attributes & Record<string, unknown>,
          children
        )
      ) : (
        <button ref={ref as React.RefObject<HTMLButtonElement>} {...sharedProps}>
          {children ?? page}
        </button>
      )}
    </li>
  )
}

NumberButton.displayName = 'NumberButton'
