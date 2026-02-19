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

/* eslint-disable no-unused-vars */

/**
 * delay in ms
 * @param ms
 * @returns
 */
export async function delay(ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

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

/**
 * Returns a hash code from a string
 * @param  {String} input The string to hash.
 * @return {String} hash to string
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 * @see https://gist.github.com/jlevy/c246006675becc446360a798e2b2d781
 */
export function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash &= hash // Convert to 32bit integer
  }
  return (hash >>> 0).toString(36)
}

// https://webbjocke.com/javascript-check-data-types/

// Returns if a value is a string
export function isString(value: any): boolean {
  return typeof value === 'string' || value instanceof String
}

// Returns if a value is really a number
export function isNumber(value: any): boolean {
  // eslint-disable-next-line no-restricted-globals
  return typeof value === 'number' && Number.isFinite(value)
}

// Returns if a value is an array
export function isArray(value: any): boolean {
  return value != null && typeof value === 'object' && value.constructor === Array
}

// Returns if a value is a function
export function isFunction(value: any): boolean {
  return typeof value === 'function'
}

// Returns if a value is an object
export function isObject(value: any): boolean {
  return value != null && typeof value === 'object' && value.constructor === Object
}

// Returns if a value is an object
export function isEmptyObject(value: any): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    value.constructor === Object &&
    Object.keys(value).length === 0
  )
}

// Returns if a value is null
export function isNull(value: any): boolean {
  return value === null
}

// Returns if a value is undefined
export function isUndefined(value: any): boolean {
  return typeof value === 'undefined'
}

// Returns if a value is a boolean
export function isBoolean(value: any): boolean {
  return typeof value === 'boolean'
}

// Returns if a value is a regexp
export function isRegExp(value: any): boolean {
  return value != null && typeof value === 'object' && value.constructor === RegExp
}

// Returns if value is a date object
export function isDate(value: any): boolean {
  return value instanceof Date
}

// Returns if a Symbol
export function isSymbol(value: any): boolean {
  return typeof value === 'symbol'
}

// Simple numerical array comparison
export function arrayEquals(array1: number[], array2: number[]): boolean {
  return array1.sort((a, b) => a - b).join(',') === array2.sort((a, b) => a - b).join(',')
}

// Conditionally inserts element to an array
export function insertIf(condition: any, ...elements: any[]): any[] {
  return condition != null ? elements : []
}

// Default date formatter
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: 'numeric',
  timeZone: 'UTC', // IMPORTANT: Will prevent hydration errors in React
  // second: 'numeric',
})

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC', // IMPORTANT: Will prevent hydration errors in React
  // second: 'numeric',
})

export const formatDate = (value: string): string => {
  const date = Date.parse(value)
  if (Number.isNaN(date)) {
    return 'Error'
  }
  return dateFormatter.format(date)
}

export const formatDateTime = (value: string): string => {
  const date = Date.parse(value)
  if (Number.isNaN(date)) {
    return 'Error'
  }
  return dateTimeFormatter.format(date)
}

export const daysRemaining = (value: string): number | string => {
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    const difference = date - Date.now()
    const days = Math.ceil(difference / (1000 * 3600 * 24))
    return Math.max(0, days)
  }
  return 'Error'
}

// Default USD currency formatter
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  minimumFractionDigits: 2,
  currency: 'USD',
})

/**
 * Accept currency value in cents and convert to formatted US dollars.
 * @param {*} value
 */
export const formatToDollarsFromCents = (value: any): string => {
  // Remove all characters except numbers.'
  if (isNumber(value)) {
    return currencyFormatter.format(value / 100)
  }
  if (isString(value)) {
    const parsed = value.replace(/[^0-9]+/g, '')
    if (!Number.isNaN(parsed)) {
      return currencyFormatter.format(Number(parsed) / 100)
    }
    return 'Error'
  }
  return 'Error'
}

export function formatNumber(number: number, decimalPlaces: number) {
  if (typeof number !== 'number' || Number.isNaN(number)) {
    throw new TypeError('Input must be a valid number')
  }

  const options = {
    minimumFractionDigits: decimalPlaces !== undefined ? decimalPlaces : 0,
    maximumFractionDigits: decimalPlaces !== undefined ? decimalPlaces : 20,
  }

  return number.toLocaleString('en-US', options)
}

export function formatFileSize(bytes: number | null | undefined, decimalPoint: number): string {
  if (bytes == null || bytes === 0) return '0 Bytes'
  const k = 1000
  const dm = decimalPoint ?? 2
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`
}

/**
 * getRemainingTime
 * @param {*} value  - remaining time in seconds
 */
export const getRemainingTime = (
  seconds: number
): {
  days: number
  hours: number
  minutes: number
  seconds: number
} => {
  let result: {
    days: number
    hours: number
    minutes: number
    seconds: number
  }
  if (seconds != null && seconds > 0) {
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    result = {
      days: d,
      hours: h,
      minutes: m,
      seconds: s,
    }
  } else {
    result = {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    }
  }
  return result
}
