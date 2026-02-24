'use client'

import { useEffect, useState } from 'react'

// undefined will use the user's locale
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short', // <- short month text (locale-aware)
  day: '2-digit',
  hour: 'numeric',
  minute: 'numeric',
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short', // <- short month text (locale-aware)
  day: '2-digit',
})

interface LocalDateTimeProps {
  value: string | Date | null | undefined
  mode?: 'datetime' | 'date'
  className?: string
  fallback?: string
}

/**
 * Client-side date/time formatter that displays dates in the user's local timezone.
 *
 * This component avoids hydration mismatches by:
 * 1. Rendering a placeholder on the server/initial render
 * 2. Updating to the correctly formatted date after hydration
 *
 * Use this instead of formatDateTime when you need to display dates
 * in the user's local timezone rather than UTC.
 */
export function LocalDateTime({
  value,
  mode = 'datetime',
  className,
  fallback = '—',
}: LocalDateTimeProps): React.JSX.Element {
  const [formattedDate, setFormattedDate] = useState<string | null>(null)

  useEffect(() => {
    if (value == null) {
      setFormattedDate(null)
      return
    }

    const date = typeof value === 'string' ? Date.parse(value) : value.getTime()
    if (Number.isNaN(date)) {
      setFormattedDate('Error')
      return
    }

    const formatter = mode === 'datetime' ? dateTimeFormatter : dateFormatter
    setFormattedDate(formatter.format(date))
  }, [value, mode])

  // Show fallback during SSR and before useEffect runs
  if (formattedDate === null) {
    return <span className={className}>{value ? '...' : fallback}</span>
  }

  return <span className={className}>{formattedDate}</span>
}

/**
 * Formats a date string to the user's local timezone.
 *
 * WARNING: Only use this in client components where hydration
 * mismatches are acceptable or managed. For most cases, prefer
 * the <LocalDateTime /> component.
 */
export function formatLocalDateTime(value: string | Date | null | undefined): string {
  if (value == null) return '—'
  const date = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (Number.isNaN(date)) return 'Error'
  return dateTimeFormatter.format(date)
}

export function formatLocalDate(value: string | Date | null | undefined): string {
  if (value == null) return '—'
  const date = typeof value === 'string' ? Date.parse(value) : value.getTime()
  if (Number.isNaN(date)) return 'Error'
  return dateFormatter.format(date)
}
