/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * **Admin-side helper.** Returns a `FieldAdminConfig` — drop into a
 * collection's `fields` map in `<collection>/admin.tsx`, keyed by the
 * schema field's name. Pairs with a plain `{ type: 'text' }` entry on
 * the schema side; this file owns the React (label icon + AI panel).
 *
 * See `docs/FIELDS.md` for the schema-vs-admin model.
 */

import type { FieldAdminConfig, FieldComponentSlots } from '@byline/core'

import { AiFieldLabel } from './ai-widgets/ai-field-label.js'
import { AiFieldPanel } from './ai-widgets/ai-field-panel.js'

/**
 * Returns a `FieldAdminConfig` that adds an AI toggle button to the field
 * label and an `<AiPluginText>` panel as an `afterField` adornment. Spread
 * any extra `components` overrides via the optional argument.
 *
 * @example
 * ```ts
 * // apps/webapp/byline/collections/news/admin.tsx
 * fields: {
 *   title: aiTextFieldAdmin(),
 * }
 * ```
 */
export function aiTextFieldAdmin(
  options: { components?: FieldComponentSlots } = {}
): FieldAdminConfig {
  const { components: extra } = options
  return {
    components: {
      Label: AiFieldLabel,
      afterField: AiFieldPanel,
      ...extra,
    },
  }
}
