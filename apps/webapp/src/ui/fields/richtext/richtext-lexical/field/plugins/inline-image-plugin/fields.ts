/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SelectValue } from '@infonomic/uikit/react'

import type { InlineImageData, InlineImageFormState } from './types'

export const positionOptions: SelectValue[] = [
  {
    label: 'Left',
    value: 'left',
  },
  {
    label: 'Right',
    value: 'right',
  },
  {
    label: 'Full',
    value: 'full',
  },
  {
    label: 'Wide',
    value: 'wide',
  },
]

// export const getFields = (imageCollection: CollectionSlug): ClientField[] => [
//   {
//     name: 'image',
//     localized: false,
//     type: 'upload',
//     required: true,
//     label: 'Image',
//     relationTo: imageCollection,
//   },
//   {
//     name: 'version',
//     localized: false,
//     type: 'text',
//     hidden: true,
//   },
//   {
//     name: 'altText',
//     required: true,
//     label: 'Alt Text',
//     localized: false,
//     type: 'text'
//   },
//   {
//     name: 'position',
//     localized: false,
//     label: 'Position',
//     options: positionOptions,
//     type: 'select'
//   },
//   {
//     name: 'showCaption',
//     label: 'Show Caption',
//     localized: false,
//     type: 'checkbox'
//   }
// ]

export function getInitialState(data: InlineImageData | undefined): InlineImageFormState {
  return {
    // TODO: Investigate - would love to have used formState and RenderFields / MappedFields
    // for the Image upload field, but for some reason I could not get a return value
    // for the selected image via handleFormOnChange or handleFormOnSubmit :-(
    // image: {
    //   value: '',
    //   initialValue: null,
    //   valid: true,
    // },
    image: {
      value: data?.id,
      initialValue: data?.id,
      valid: true,
    },
    altText: {
      value: data?.altText,
      initialValue: data?.altText,
      valid: true,
    },
    position: {
      value: data?.position ?? 'full',
      initialValue: data?.position ?? 'full',
      valid: true,
    },
    showCaption: {
      value: data?.showCaption ?? false,
      initialValue: data?.showCaption ?? false,
      valid: true,
    },
  }
}

export function isAltTextValid(value: string | undefined): boolean {
  return value != null && value.length > 0
}

export function validateFields(fields: InlineImageFormState): {
  valid: boolean
  fields: InlineImageFormState
} {
  let valid = true

  if (fields.altText != null) {
    if (isAltTextValid(fields.altText.value as string | undefined) === false) {
      fields.altText.valid = false
      valid = false
    } else {
      fields.altText.valid = true
    }
  }
  // Return
  return {
    valid,
    fields,
  }
}
