/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { Table } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useNavigate } from './loose-router.js'
import { SortAscendingIcon, SortDescendingIcon, SortNeutralIcon } from './sort-icons.js'
import styles from './th-sortable.module.css'

type TableHeadingCellProps = React.JSX.IntrinsicElements['th']

export interface TableHeadingCellSortableProps extends TableHeadingCellProps {
  label: string
  path?: string
  fieldName?: string
  sortable?: boolean
  desc?: boolean
  align?: 'left' | 'center' | 'right'
  className?: string
}

export function TableHeadingCellSortable({
  path: _path = '/',
  fieldName,
  label,
  sortable = false,
  align = 'left',
  className,
  ...rest
}: TableHeadingCellSortableProps & {
  ref?: React.RefObject<HTMLTableCellElement>
}) {
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })

  const [desc, setDesc] = useState<boolean | null>(null)

  const handleOnSort = (descending: boolean) => (): void => {
    if (fieldName != null) {
      const params = structuredClone(location.search)
      delete params.page
      params.order = fieldName
      params.desc = descending
      setDesc(descending)
      navigate({
        to: location.pathname as never,
        search: params,
      })
    }
  }

  useEffect(() => {
    if (fieldName != null) {
      const order = (location.search as Record<string, unknown>).order
      const d = (location.search as Record<string, unknown>).desc as boolean | undefined
      if (order === fieldName) {
        setDesc(d ?? false)
      } else {
        setDesc(null)
      }
    }
  }, [fieldName, location.search])

  const alignClasses = cx({
    'byline-th-align-left': align === 'left',
    [styles.alignLeft]: align === 'left',
    'byline-th-align-center': align === 'center',
    [styles.alignCenter]: align === 'center',
    'byline-th-align-right': align === 'right',
    [styles.alignRight]: align === 'right',
  })

  if (sortable === false) {
    return (
      <Table.HeadingCell className={cx('byline-th-sortable', className, alignClasses)} {...rest}>
        {label}
      </Table.HeadingCell>
    )
  }

  const getSortIcon = () => {
    if (desc === null) return <SortNeutralIcon />
    if (desc === true) return <SortDescendingIcon />
    return <SortAscendingIcon />
  }

  return (
    <Table.HeadingCell className={cx('byline-th-sortable', className)} {...rest}>
      <button
        type="button"
        className={cx(
          'byline-th-sortable-button',
          styles.button,
          alignClasses,
          align === 'right' && [styles.alignRightAuto, 'byline-th-align-right-auto']
        )}
        onClick={handleOnSort(desc !== true)}
      >
        <span>{label}</span>
        {getSortIcon()}
      </button>
    </Table.HeadingCell>
  )
}
