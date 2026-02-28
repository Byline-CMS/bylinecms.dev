/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

import { Table } from '@infonomic/uikit/react'
import cx from 'classnames'

import {
  SortAscendingIcon,
  SortDescendingIcon,
  SortNeutralIcon,
} from '@/ui/components/sort-icons.tsx'

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
  path = '/',
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
        to: location.pathname,
        search: params,
      })
    }
  }

  useEffect(() => {
    if (fieldName != null) {
      const order = location.search.order
      const desc = location.search.desc
      if (order === fieldName) {
        setDesc(desc ?? false)
      } else {
        setDesc(null)
      }
    }
  }, [fieldName, location.search.order, location.search.desc])

  if (sortable === false) {
    return (
      <Table.HeadingCell
        className={cx(
          className,
          { 'text-left': align === 'left' },
          { 'text-center': align === 'center' },
          { 'text-right': align === 'right' }
        )}
        {...rest}
      >
        {label}
      </Table.HeadingCell>
    )
  }

  const getSortIcon = () => {
    if (desc === null) {
      return <SortNeutralIcon />
    }
    if (desc === true) {
      return <SortDescendingIcon />
    }
    if (desc === false) {
      return <SortAscendingIcon />
    }
  }

  return (
    <Table.HeadingCell className={className} {...rest}>
      <button
        type="button"
        className={cx(
          'flex font-bold gap-1 pl-[2px] pr-[6px] hover:underline',
          { 'text-left': align === 'left' },
          { 'text-center': align === 'center' },
          { 'text-right': align === 'right' },
          { 'ml-auto': align === 'right' }
        )}
        onClick={handleOnSort(desc !== true)}
      >
        <span>{label}</span>
        {getSortIcon()}
      </button>
    </Table.HeadingCell>
  )
}
