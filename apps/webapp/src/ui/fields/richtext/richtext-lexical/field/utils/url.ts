/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// NOTE: TODO - revisit - added relative paths that begin with forward slash to
// supported protocols.
const SUPPORTED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'sms:', 'tel:'])

export function sanitizeUrl(url: string): string {
  // Short circuit to allow relative paths beginning with forward slash
  if (url?.startsWith('/')) {
    return url
  }

  try {
    // console.log('attempting to sanitize from utils')
    const parsedUrl = new URL(url)
    // eslint-disable-next-line no-script-url
    if (!SUPPORTED_URL_PROTOCOLS.has(parsedUrl.protocol)) {
      return 'about:blank'
    }
  } catch (_e) {
    // console.error(e)
    return 'https://'
  }
  return url
}

// Source: https://stackoverflow.com/a/8234912/2013580
const urlRegExp =
  /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/
export function validateUrl(url: string): boolean {
  // TODO Fix UI for link insertion; it should never default to an invalid URL such as https://.
  // Maybe show a dialog where they user can type the URL before inserting it.
  return url === 'https://' || urlRegExp.test(url)
}

export function encodeRelativeUrl(url: string): string {
  const segments = url.split('/')
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    segments[index] = encodeURIComponent(segment)
  }
  return segments.join('/')
}
