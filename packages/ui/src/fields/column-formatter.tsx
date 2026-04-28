/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ColumnFormatter, FormatterProps } from '@byline/core'

/**
 * Type guard: returns true when the formatter is a `{ component }` wrapper
 * rather than a plain function.
 */
export function isComponentFormatter<T>(
  fmt: ColumnFormatter<T>
): fmt is { component: (props: FormatterProps<T>) => any } {
  return typeof fmt === 'object' && fmt !== null && 'component' in fmt
}

/**
 * Render a cell value through its column formatter (if any).
 * Handles both plain-function and `{ component }` formatters.
 */
export function renderFormatted(value: any, document: any, formatter: ColumnFormatter) {
  if (isComponentFormatter(formatter)) {
    const Component = formatter.component
    return <Component value={value} record={document} />
  }
  return formatter(value, document)
}
