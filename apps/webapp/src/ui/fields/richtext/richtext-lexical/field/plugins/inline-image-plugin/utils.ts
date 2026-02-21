/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export function getPreferredSize(
  preferred: string,
  doc: Record<string, any>
): {
  width?: number
  height?: number
  mimeType: string
  filesize: number
  filename: string
  url: string
} | null {
  if (doc.mimeType === 'image/svg+xml' && doc.url != null) {
    return {
      mimeType: doc.mimeType as string,
      filesize: doc.filesize as number,
      filename: doc.filename as string,
      url: doc.url as string,
    }
  }
  if (doc.sizes?.[preferred as keyof object]?.filename != null) {
    return doc.sizes[preferred as keyof object]
  }
  if (doc.url != null) {
    return {
      width: doc.with as number,
      height: doc.height as number,
      mimeType: doc.mimeType as string,
      filesize: doc.filesize as number,
      filename: doc.filename as string,
      url: doc.url as string,
    }
  }
  return null
}
