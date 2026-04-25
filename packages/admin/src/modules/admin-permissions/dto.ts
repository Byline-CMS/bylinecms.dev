/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AbilityDescriptor } from '@byline/auth'

import type { AbilityDescriptorResponse } from './schemas.js'

/**
 * Shape an `AbilityDescriptor` from the registry into its public
 * response form. Identity-shaped today — the indirection exists so
 * that future internal-only fields on `AbilityDescriptor` (e.g. a
 * registration timestamp) stay opted out of the public shape by
 * default.
 */
export function toAbilityDescriptor(descriptor: AbilityDescriptor): AbilityDescriptorResponse {
  return {
    key: descriptor.key,
    label: descriptor.label,
    description: descriptor.description ?? null,
    group: descriptor.group,
    source: descriptor.source ?? null,
  }
}
