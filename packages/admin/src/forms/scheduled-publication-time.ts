/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export interface ScheduledPublicationInstantChoice {
  iso: string
  offsetLabel: string
}

export type ScheduledPublicationWallTimeResolution =
  | { status: 'invalid' }
  | { status: 'nonexistent' }
  | { status: 'valid'; choices: ScheduledPublicationInstantChoice[] }

interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function parseWallParts(value: string): WallParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (match == null) return null
  const [, year, month, day, hour, minute] = match
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  }
  if (
    parts.year < 1 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    return null
  }
  const calendar = new Date(0)
  calendar.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  calendar.setUTCHours(parts.hour, parts.minute, 0, 0)
  if (
    calendar.getUTCFullYear() !== parts.year ||
    calendar.getUTCMonth() !== parts.month - 1 ||
    calendar.getUTCDate() !== parts.day
  ) {
    return null
  }
  return parts
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

function zonedParts(format: Intl.DateTimeFormat, epochMs: number): WallParts & { second: number } {
  const values = Object.fromEntries(
    format
      .formatToParts(epochMs)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )
  return {
    year: values.year ?? Number.NaN,
    month: values.month ?? Number.NaN,
    day: values.day ?? Number.NaN,
    hour: values.hour ?? Number.NaN,
    minute: values.minute ?? Number.NaN,
    second: values.second ?? Number.NaN,
  }
}

function sameWallTime(actual: WallParts, expected: WallParts): boolean {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute
  )
}

function offsetMinutes(format: Intl.DateTimeFormat, epochMs: number): number {
  const parts = zonedParts(format, epochMs)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return Math.round((localAsUtc - epochMs) / 60_000)
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const remainingMinutes = String(absolute % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${remainingMinutes}`
}

/**
 * Resolve a browser-entered wall time in an explicit IANA zone. Returns no
 * choice for a daylight-saving gap and two choices for an overlap, forcing
 * the editor to choose an actual instant rather than accepting JS Date's
 * silent normalization.
 */
export function resolveScheduledPublicationWallTime(
  value: string,
  timeZone: string
): ScheduledPublicationWallTimeResolution {
  const wall = parseWallParts(value)
  if (wall == null) return { status: 'invalid' }

  let format: Intl.DateTimeFormat
  try {
    format = formatter(timeZone)
  } catch {
    return { status: 'invalid' }
  }

  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(offsetMinutes(format, wallAsUtc + hours * 3_600_000))
  }

  const choices = Array.from(offsets)
    .map((offset) => ({ epochMs: wallAsUtc - offset * 60_000, offset }))
    .filter(({ epochMs }) => sameWallTime(zonedParts(format, epochMs), wall))
    .sort((left, right) => left.epochMs - right.epochMs)
    .map(({ epochMs, offset }) => ({
      iso: new Date(epochMs).toISOString(),
      offsetLabel: formatOffset(offset),
    }))

  if (choices.length === 0) return { status: 'nonexistent' }
  return { status: 'valid', choices }
}
