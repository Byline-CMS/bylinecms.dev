/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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
