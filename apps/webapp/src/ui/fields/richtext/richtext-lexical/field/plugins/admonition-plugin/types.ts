/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdmonitionType } from '../../nodes/admonition-node/types'

export interface AdmonitionFormState {
  title: {
    value?: string
    initialValue?: string
    valid: boolean
  }
  admonitionType: {
    value?: AdmonitionType
    initialValue?: AdmonitionType
    valid: boolean
  }
}

export interface AdmonitionData {
  admonitionType: AdmonitionType
  title: string
}

export interface AdmonitionDrawerProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: AdmonitionData) => void
  data: {
    admonitionType?: AdmonitionType
    title?: string
  }
}
