/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * truncate
 * @param str
 * @param length
 * @param useWordBoundary
 * @returns
 */
export function truncate(
  str: string,
  length: number,
  useWordBoundary: boolean,
  useSuffix = true
): string {
  if (str == null || str.length <= length) {
    return str
  }
  const subString = str.slice(0, length - 2) // the original check - less 2 so zero based + '...' will respect length
  const truncated = useWordBoundary ? subString.slice(0, subString.lastIndexOf(' ')) : subString
  return useSuffix ? `${truncated}...` : truncated
}
