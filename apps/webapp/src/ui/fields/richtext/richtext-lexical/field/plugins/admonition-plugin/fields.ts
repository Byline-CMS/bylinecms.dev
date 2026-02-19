/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { RadioGroupValue } from '@infonomic/uikit/react'

import type { AdmonitionType } from '../../nodes/admonition-node'
import type { AdmonitionFormState } from './types'

export const admonitionTypeOptions: RadioGroupValue[] = [
  {
    id: 'note',
    label: 'Note',
    value: 'note',
  },
  {
    id: 'tip',
    label: 'Tip',
    value: 'tip',
  },
  {
    id: 'warning',
    label: 'Warning',
    value: 'warning',
  },
  {
    id: 'danger',
    label: 'Danger',
    value: 'danger',
  },
]

// export const getFields = (): ClientField[] => {
//   return [
//     {
//       name: 'title',
//       localized: false,
//       label: 'Title',
//       required: true,
//       type: 'text'
//     },
//     {
//       name: 'admonitionType',
//       localized: false,
//       type: 'radio',
//       label: 'Type',
//       options: admonitionTypeOptions
//     }
//   ]
// }

export function getInitialState(data: {
  admonitionType?: AdmonitionType
  title?: string
}): AdmonitionFormState {
  return {
    title: {
      value: data?.title,
      initialValue: data?.title,
      valid: true,
    },
    admonitionType: {
      value: data?.admonitionType ?? 'note',
      initialValue: data?.admonitionType ?? 'note',
      valid: true,
    },
  }
}

export function isTitleValid(value: string | undefined): boolean {
  return value != null && value.length > 0
}

export function validateFields(fields?: AdmonitionFormState): {
  valid: boolean
  fields: AdmonitionFormState
} {
  let valid = true
  if (fields == null) {
    return {
      valid: false,
      fields: getInitialState({}),
    }
  }

  if (fields.title != null) {
    if (isTitleValid(fields.title.value as string | undefined) === false) {
      fields.title.valid = false
      valid = false
    } else {
      fields.title.valid = true
    }
  }

  return {
    valid,
    fields,
  }
}
